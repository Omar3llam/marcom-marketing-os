import { describe, it, expect } from 'vitest';
import { reconcile } from './blendedTruthEngine.js';
import { exactRevenueWindow, unknownRevenueWindow } from '../../lib/revenueMeasurementWindow.js';

const august = exactRevenueWindow('2026-08-01', '2026-08-30');
const september = exactRevenueWindow('2026-09-01', '2026-09-30');
const money = (currency = 'EGP') => ({ monetaryStatus: 'MONETARY_VALID', currency, monetaryReason: null });
const channel = (over = {}) => ({ channelId: 'a', platformRevenueMinor: 100, actualRevenueMinor: 75, spendMinor: 25,
  platformRevenueWindow: august, actualRevenueWindow: august, spendWindow: august,
  monetaryEvidence: { platform: money(), actual: money(), spend: money(), blended: money() }, ...over });

describe('P7-07D reconciliation authority', () => {
  it.each([
    [{ actualRevenueWindow: september }, 'MEASUREMENT_WINDOW_MISMATCH'],
    [{ platformRevenueWindow: unknownRevenueWindow() }, 'MEASUREMENT_WINDOW_UNKNOWN'],
    [{ actualRevenueWindow: unknownRevenueWindow() }, 'MEASUREMENT_WINDOW_UNKNOWN'],
    [{ monetaryEvidence: { platform: money('USD'), actual: money(), spend: money(), blended: money() } }, 'MONETARY_BASIS_UNAVAILABLE'],
  ])('withholds a gap for %j', (over, reason) => {
    const { channels, portfolio } = reconcile({ channels: [channel(over)] });
    expect(channels[0].reconciliation).toMatchObject({ status: 'UNAVAILABLE', reason, gapMinor: null, gapPct: null });
    expect(channels[0].gapMinor).toBeNull(); expect(channels[0].gapPct).toBeNull();
    expect(portfolio.unavailableCount).toBe(1); expect(portfolio.reconciledCount).toBe(0);
  });
  it('absence of actuals is not equality, and platform efficiency survives', () => {
    const { channels, portfolio } = reconcile({ channels: [channel({ actualRevenueMinor: null })] });
    expect(channels[0].reconciliation).toMatchObject({ status: 'UNVERIFIED', reason: 'ACTUAL_REVENUE_UNAVAILABLE', gapMinor: null, gapPct: null });
    expect(channels[0].gapMinor).toBeNull(); expect(portfolio.gapMinor).toBeNull();
    expect(channels[0].platformRoas).toBe(4); expect(channels[0].blendedRevenueMinor).toBe(100);
  });
  it.each([[100, 75, 25, .25], [100, 125, -25, -.25], [100, 100, 0, 0], [0, 0, 0, 0], [0, 100, -100, null]])(
    'preserves signed measured gaps including zero: %s / %s', (platformRevenueMinor, actualRevenueMinor, gapMinor, gapPct) => {
      const result = reconcile({ channels: [channel({ platformRevenueMinor, actualRevenueMinor })] });
      for (const row of [result.channels[0], result.portfolio]) {
        expect(row.reconciliation).toMatchObject({ status: 'AVAILABLE', reason: null, currency: 'EGP', window: august,
          windowCompatibility: 'COMPATIBLE', gapMinor, gapPct, gapDenominator: 'PLATFORM_REVENUE',
          gapPctReason: gapPct === null ? 'ZERO_PLATFORM_DENOMINATOR' : null });
        expect(row.gapMinor).toBe(gapMinor); expect(row.gapPct).toBe(gapPct);
      }
    });
  it('keeps actual/spend efficiency independent of platform/actual reconciliation', () => {
    const { channels, portfolio } = reconcile({ channels: [channel({ platformRevenueWindow: september })] });
    expect(channels[0].blendedRevenueEfficiency).toMatchObject({ status: 'VALID', value: 3 });
    expect(portfolio.blendedRevenueEfficiency).toMatchObject({ status: 'VALID', value: 3 });
    expect(channels[0].reconciliation?.status).toBe('UNAVAILABLE');
    expect(channels[0].blendedRevenueMinor).toBe(75);
  });
  it('aggregates only comparable channels and discloses the excluded population', () => {
    const { portfolio } = reconcile({ channels: [channel(), channel({ channelId: 'b' }),
      channel({ channelId: 'c', actualRevenueMinor: null }), channel({ channelId: 'd', actualRevenueWindow: september })] });
    expect(portfolio).toMatchObject({ reconciledCount: 2, unverifiedCount: 1, unavailableCount: 1, totalChannelCount: 4 });
    expect(portfolio.reconciliation).toMatchObject({ status: 'AVAILABLE', platformRevenueMinor: 200, actualRevenueMinor: 150, gapMinor: 50, gapPct: .25 });
    expect(portfolio.gapPct).toBe(.25);
  });
  it.each([
    [channel({ channelId: 'b', platformRevenueWindow: september, actualRevenueWindow: september }), 'PORTFOLIO_WINDOW_MISMATCH'],
    [channel({ channelId: 'b', monetaryEvidence: { platform: money('USD'), actual: money('USD'), spend: money('USD'), blended: money('USD') } }), 'PORTFOLIO_CURRENCY_MISMATCH'],
  ])('refuses incompatible portfolio aggregation while retaining channel gaps', (other, reason) => {
    const { channels, portfolio } = reconcile({ channels: [channel(), other] });
    expect(channels.every(c => c.reconciliation?.status === 'AVAILABLE')).toBe(true);
    expect(portfolio.reconciliation).toMatchObject({ status: 'UNAVAILABLE', reason, gapMinor: null, gapPct: null });
    expect(portfolio.gapMinor).toBeNull();
  });
});
