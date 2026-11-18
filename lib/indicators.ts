// Daily technical indicators (RSI and Bollinger Bands) from a list of closes, plus the parsing of Yahoo's daily
// chart into completed sessions. Pure functions, covered by __tests__/indicators.test.ts; the route that fetches
// the data is app/api/indicators/route.ts.

export const RSI_PERIOD = 14;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_STD_DEVS = 2;

// RSI(14) needs 14 changes, so 15 closes; the bands need 20 closes
export const MIN_CLOSES_RSI = RSI_PERIOD + 1;
export const MIN_CLOSES_BOLLINGER = BOLLINGER_PERIOD;

export type DailyClose = { date: string; close: number };

export class InsufficientDataError extends Error {
    constructor(public readonly indicator: string, public readonly needed: number, public readonly available: number) {
        super(`Not enough daily closes for ${indicator}: need ${needed}, have ${available}`);
    }
}

// Wilder's RSI, as charting sites (TradingView, Yahoo, StockCharts) compute it: the first average is a simple mean
// of the first 14 gains and losses, every later one is smoothed as avg = (prev * 13 + current) / 14.
// The full history is used so the smoothing has settled; the value is for the last close.
export function rsi(closes: number[], period = RSI_PERIOD): number {
    if (closes.length < period + 1) throw new InsufficientDataError(`RSI(${period})`, period + 1, closes.length);
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

// Bollinger Bands over the last `period` closes: the simple moving average, plus and minus `stdDevs` population
// standard deviations (the convention TradingView and Bollinger himself use).
export function bollinger(closes: number[], period = BOLLINGER_PERIOD, stdDevs = BOLLINGER_STD_DEVS) {
    if (closes.length < period) throw new InsufficientDataError(`Bollinger(${period})`, period, closes.length);
    const window = closes.slice(-period);
    const middle = window.reduce((sum, c) => sum + c, 0) / period;
    const variance = window.reduce((sum, c) => sum + (c - middle) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: middle + stdDevs * sd, middle, lower: middle - stdDevs * sd };
}

// How far the price sits above (+) or below (-) the lower band, as a percentage of the band
export const percentFromLowerBand = (price: number, lower: number) => ((price - lower) / lower) * 100;

const round = (n: number, digits: number) => Number(n.toFixed(digits));

export function computeIndicators(series: DailyClose[]) {
    const closes = series.map((d) => d.close);
    const last = series[series.length - 1];
    if (!last) throw new InsufficientDataError('the last close', 1, 0);
    // Both are computed (and so both can throw) before anything is returned: never half an answer
    const rsiValue = rsi(closes);
    const bands = bollinger(closes);
    return {
        lastClose: round(last.close, 4),
        lastCloseDate: last.date,
        rsi14: round(rsiValue, 2),
        bollinger: {
            period: BOLLINGER_PERIOD,
            stdDevs: BOLLINGER_STD_DEVS,
            upper: round(bands.upper, 4),
            middle: round(bands.middle, 4),
            lower: round(bands.lower, 4),
        },
        percentFromLowerBand: round(percentFromLowerBand(last.close, bands.lower), 2),
        closesUsed: closes.length,
    };
}

type YahooDailyChartJson = {
    chart?: {
        result?: Array<{
            meta?: {
                currency?: string;
                symbol?: string;
                exchangeTimezoneName?: string;
                currentTradingPeriod?: { regular?: { start?: number; end?: number } };
            };
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
        error?: { code?: string; description?: string } | null;
    };
};

// The calendar date of a session in the exchange's own time zone, as YYYY-MM-DD
const sessionDate = (unixSeconds: number, timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(unixSeconds * 1000));

// Completed daily sessions from a Yahoo /v8/finance/chart?interval=1d response, oldest first. Days without a close
// (halts, holidays Yahoo pads) are dropped. While the exchange is in its regular session, Yahoo's last bar is today's
// unfinished one: it is dropped too, so `close` is always a real closing price.
export function dailyClosesFromChart(json: unknown, nowSeconds = Math.floor(Date.now() / 1000)) {
    const result = (json as YahooDailyChartJson)?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const timeZone = meta.exchangeTimezoneName || 'America/New_York';
    const timestamps = result.timestamp ?? [];
    const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
    let series: DailyClose[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const close = rawCloses[i];
        if (typeof close === 'number' && Number.isFinite(close) && close > 0) {
            series.push({ date: sessionDate(timestamps[i], timeZone), close });
        }
    }
    const regular = meta.currentTradingPeriod?.regular;
    if (regular?.start && regular?.end && nowSeconds >= regular.start && nowSeconds < regular.end) {
        const today = sessionDate(regular.start, timeZone);
        if (series.length && series[series.length - 1].date === today) series = series.slice(0, -1);
    }
    // Yahoo occasionally repeats a session; keep the last value for each date
    const byDate = new Map(series.map((d) => [d.date, d] as const));
    return {
        symbol: meta.symbol,
        currency: meta.currency,
        timeZone,
        closes: [...byDate.values()],
    };
}
