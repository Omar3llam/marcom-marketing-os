import { describe, expect, it } from 'vitest';
import { evaluateBlendedRevenueEfficiency as evaluate, EFFICIENCY_REASON } from './blendedRevenueEfficiency.js';
import { exactRevenueWindow, unknownRevenueWindow } from './revenueMeasurementWindow.js';

const usd = { monetaryStatus: 'MONETARY_VALID', currency: 'USD' };
const eur = { monetaryStatus: 'MONETARY_VALID', currency: 'EUR' };
const untrusted = { monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED', currency: null };
const utc = (start, end) => exactRevenueWindow(start, end);
const a = utc('2026-08-01T04:00:00Z', '2026-09-01T04:00:00Z');
const b = utc('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z');
const input = (over = {}) => ({ revenueMinor: 300, spendMinor: 100,
  revenueMoney: usd, spendMoney: usd, revenueWindow: a, spendWindow: a, ...over });

describe('blended revenue efficiency eligibility', () => {
  it('divides selected revenue by compatible paid-media spend only with exact evidence', () => {
    expect(evaluate(input())).toMatchObject({ status: 'VALID', value: 3, currency: 'USD', windowCompatibility: 'COMPATIBLE' });
    expect(evaluate(input({ revenueMinor: 0 })).value).toBe(0);
  });
  it.each([
    [{ revenueWindow: b }, EFFICIENCY_REASON.MEASUREMENT_WINDOW_MISMATCH],
    [{ revenueWindow: utc('2026-08-15T04:00:00Z', '2026-09-01T04:00:00Z') }, EFFICIENCY_REASON.MEASUREMENT_WINDOW_MISMATCH],
    [{ revenueWindow: unknownRevenueWindow() }, EFFICIENCY_REASON.MEASUREMENT_WINDOW_UNKNOWN],
    [{ spendWindow: unknownRevenueWindow() }, EFFICIENCY_REASON.MEASUREMENT_WINDOW_UNKNOWN],
    [{ spendMoney: eur }, EFFICIENCY_REASON.CURRENCY_MISMATCH],
    [{ revenueMoney: untrusted }, EFFICIENCY_REASON.CURRENCY_UNTRUSTED],
    [{ spendMinor: 0 }, EFFICIENCY_REASON.ZERO_DENOMINATOR],
    [{ revenueMinor: null }, EFFICIENCY_REASON.REVENUE_BASIS_UNAVAILABLE],
    [{ spendMinor: null }, EFFICIENCY_REASON.SPEND_BASIS_UNAVAILABLE],
  ])('keeps invalid evidence unavailable (%s)', (override, reason) => {
    expect(evaluate(input(override))).toMatchObject({ status: 'UNAVAILABLE', reason, value: null });
  });
});
