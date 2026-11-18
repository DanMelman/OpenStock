import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { computeIndicators, dailyClosesFromChart, InsufficientDataError } from "@/lib/indicators";
import { normalizeYahooSymbol } from "@/lib/yahoo";

// GET /api/indicators?symbol=STX with header x-api-key: <INDICATORS_API_KEY>
// Last daily close, RSI(14) and Bollinger(20, 2) from a year of daily closes. For scripts and scheduled scans,
// not the UI, so it is guarded by a shared key instead of a session.
//
// Data: Yahoo Finance daily chart (already used for Tadawul and Warsaw quotes). Finnhub's /stock/candle is not
// available on the free plan, so it cannot supply daily history here.

const SYMBOL_PATTERN = /^[A-Z0-9.:\-^=]{1,24}$/;
// TradingView-style prefixes for US listings: "NASDAQ:STX" -> "STX"
const US_PREFIX = /^(NASDAQ|NYSE|AMEX|NYSEARCA|ARCA|BATS|OTC):/;
const CACHE_SECONDS = 300;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function isAuthorized(req: NextRequest, expected: string) {
    const given = req.headers.get("x-api-key");
    if (!given) return false;
    // Hash both so the comparison is constant-time whatever the lengths
    return timingSafeEqual(sha256(given), sha256(expected));
}

const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error: code, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

function toYahooSymbol(symbol: string) {
    return normalizeYahooSymbol(symbol) ?? symbol.replace(US_PREFIX, "");
}

export async function GET(req: NextRequest) {
    const expected = process.env.INDICATORS_API_KEY;
    if (!req.headers.get("x-api-key")) return error(401, "unauthorized", "Missing x-api-key header");
    if (!expected) return error(503, "not_configured", "INDICATORS_API_KEY is not set on the server");
    if (!isAuthorized(req, expected)) return error(401, "unauthorized", "Invalid API key");

    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) return error(400, "invalid_symbol", "Pass ?symbol=, e.g. ?symbol=STX");
    const yahooSymbol = toYahooSymbol(symbol);

    let json: unknown;
    try {
        const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1y`,
            {
                headers: { "User-Agent": "Mozilla/5.0" },
                next: { revalidate: CACHE_SECONDS },
                signal: AbortSignal.timeout(8000),
            },
        );
        if (res.status === 404) return error(404, "unknown_symbol", `No daily data for ${symbol}`, { symbol });
        if (!res.ok) return error(502, "upstream_error", `Data source answered ${res.status}`, { symbol });
        json = await res.json();
    } catch (e) {
        console.error("Indicators fetch error", yahooSymbol, e);
        return error(502, "upstream_error", "Data source did not respond", { symbol });
    }

    const parsed = dailyClosesFromChart(json);
    if (!parsed) return error(404, "unknown_symbol", `No daily data for ${symbol}`, { symbol });

    try {
        const indicators = computeIndicators(parsed.closes);
        return NextResponse.json(
            {
                symbol,
                source: "yahoo",
                sourceSymbol: parsed.symbol ?? yahooSymbol,
                currency: parsed.currency ?? null,
                ...indicators,
            },
            { headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` } },
        );
    } catch (e) {
        if (e instanceof InsufficientDataError) {
            return error(422, "insufficient_data", e.message, {
                symbol,
                indicator: e.indicator,
                closesNeeded: e.needed,
                closesAvailable: e.available,
            });
        }
        throw e;
    }
}
