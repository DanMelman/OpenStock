import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/indicators/route';

const KEY = 'test-key';
const req = (symbol: string, key?: string) =>
    new NextRequest(`http://localhost/api/indicators?symbol=${symbol}`, { headers: key ? { 'x-api-key': key } : {} });

// A finished trading history of `n` sessions, well in the past so no bar is "today"
function chart(n: number) {
    const start = Date.UTC(2025, 0, 2, 14, 30) / 1000;
    const timestamp = Array.from({ length: n }, (_, i) => start + i * 86400);
    const close = timestamp.map((_, i) => 100 + Math.sin(i / 3) * 4);
    return { chart: { result: [{ meta: { symbol: 'STX', currency: 'USD', exchangeTimezoneName: 'America/New_York' }, timestamp, indicators: { quote: [{ close }] } }] } };
}

describe('GET /api/indicators', () => {
    beforeEach(() => { vi.stubEnv('INDICATORS_API_KEY', KEY); });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('answers 401 without a key or with a wrong one, before any data call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect((await GET(req('STX'))).status).toBe(401);
        expect((await GET(req('STX', 'wrong'))).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns the last close, RSI and Bollinger bands', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(chart(250))));
        const res = await GET(req('stx', KEY));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ symbol: 'STX', source: 'yahoo', currency: 'USD', closesUsed: 250 });
        expect(body.rsi14).toBeGreaterThan(0);
        expect(body.bollinger.lower).toBeLessThan(body.bollinger.upper);
        expect(typeof body.percentFromLowerBand).toBe('number');
        expect(body.lastCloseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('answers 422 with no values when history is too short', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(chart(12))));
        const res = await GET(req('NEWIPO', KEY));
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('insufficient_data');
        expect(body.rsi14).toBeUndefined();
    });
});
