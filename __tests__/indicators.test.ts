import { describe, expect, it } from 'vitest';
import { bollinger, computeIndicators, dailyClosesFromChart, InsufficientDataError, percentFromLowerBand, rsi } from '@/lib/indicators';

// StockCharts' worked RSI example (Wilder smoothing). Their sheet rounds the averages to 2 decimals and prints 70.53;
// unrounded the first value is 70.46, and the later ones agree within rounding.
const WILDER = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];

describe('RSI(14)', () => {
    it('matches the published Wilder values', () => {
        expect(rsi(WILDER.slice(0, 15))).toBeCloseTo(70.46, 2);
        expect(rsi(WILDER.slice(0, 16))).toBeCloseTo(66.32, 0);
        expect(rsi(WILDER)).toBeCloseTo(57.97, 0);
    });

    it('is 100 with no losses and 50 when flat', () => {
        expect(rsi(Array.from({ length: 20 }, (_, i) => 10 + i))).toBe(100);
        expect(rsi(Array(20).fill(10))).toBe(50);
    });

    it('refuses fewer than 15 closes', () => {
        expect(() => rsi(WILDER.slice(0, 14))).toThrow(InsufficientDataError);
    });
});

describe('Bollinger(20, 2)', () => {
    it('uses the SMA and the population standard deviation of the last 20 closes', () => {
        const closes = [...Array(5).fill(999), ...Array.from({ length: 20 }, (_, i) => (i % 2 ? 12 : 8))];
        const b = bollinger(closes);
        expect(b.middle).toBe(10);
        expect(b.upper).toBe(14);
        expect(b.lower).toBe(6);
    });

    it('refuses fewer than 20 closes', () => {
        expect(() => bollinger(Array(19).fill(1))).toThrow(InsufficientDataError);
    });

    it('gives the distance from the lower band in percent', () => {
        expect(percentFromLowerBand(102, 100)).toBeCloseTo(2);
        expect(percentFromLowerBand(95, 100)).toBeCloseTo(-5);
    });
});

describe('computeIndicators', () => {
    it('returns everything for the last close, or throws without enough data', () => {
        const series = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close: 100 + Math.sin(i) * 5 }));
        const out = computeIndicators(series);
        expect(out.lastCloseDate).toBe('2026-01-30');
        expect(out.closesUsed).toBe(30);
        expect(out.bollinger.lower).toBeLessThan(out.bollinger.middle);
        expect(() => computeIndicators(series.slice(0, 18))).toThrow(/Bollinger/);
        expect(() => computeIndicators([])).toThrow(InsufficientDataError);
    });
});

describe('dailyClosesFromChart', () => {
    // 2026-11-16 and 17 at 09:30 New York (14:30 UTC), plus today's bar on the 18th
    const t = (day: number) => Date.UTC(2026, 10, day, 14, 30) / 1000;
    const chart = {
        chart: {
            result: [{
                meta: {
                    symbol: 'STX', currency: 'USD', exchangeTimezoneName: 'America/New_York',
                    currentTradingPeriod: { regular: { start: t(18), end: t(18) + 6.5 * 3600 } },
                },
                timestamp: [t(13), t(16), t(17), t(18)],
                indicators: { quote: [{ close: [100, null, 102, 103] }] },
            }],
        },
    };

    it('drops missing closes and dates sessions in the exchange time zone', () => {
        const out = dailyClosesFromChart(chart, t(18) + 8 * 3600)!;
        expect(out.closes).toEqual([
            { date: '2026-11-13', close: 100 },
            { date: '2026-11-17', close: 102 },
            { date: '2026-11-18', close: 103 },
        ]);
    });

    it("drops today's unfinished bar during the session", () => {
        const out = dailyClosesFromChart(chart, t(18) + 3600)!;
        expect(out.closes.at(-1)).toEqual({ date: '2026-11-17', close: 102 });
    });

    it('returns null for an empty or error response', () => {
        expect(dailyClosesFromChart({ chart: { result: null, error: { code: 'Not Found' } } })).toBeNull();
    });
});
