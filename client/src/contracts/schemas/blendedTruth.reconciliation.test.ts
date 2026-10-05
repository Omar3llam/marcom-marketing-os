import { describe, it, expect } from 'vitest';
import { BlendedTruthSchema } from './blendedTruth.schema';

const window = { windowStatus: 'EXACT', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z' };
const reconciliation = { status: 'AVAILABLE', reason: null, windowCompatibility: 'COMPATIBLE', window, currency: 'EGP',
  platformRevenueMinor: 100, actualRevenueMinor: 75, gapMinor: 25, gapPct: .25, gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE' };
const row = { channelId: 'a', spendMinor: 25, platformRevenueMinor: 100, actualRevenueMinor: 75, blendedRevenueMinor: 75,
  gapMinor: 25, gapPct: .25, platformRoas: 4, blendedRoas: 3, coverage: 'RECONCILED', confidence: 'HIGH', reconciliation };
const payload = (over = {}) => ({ channels: [{ ...row, reconciliation: { ...reconciliation, ...over } }],
  portfolio: { ...row, reconciliation: { ...reconciliation, reconciledCount: 1, unverifiedCount: 0, unavailableCount: 0, totalChannelCount: 1 }, reconciledCount: 1, unverifiedCount: 0, unavailableCount: 0, totalChannelCount: 1 } });
describe('required Blended reconciliation contract', () => {
  it('retains the published basis', () => expect(BlendedTruthSchema.parse(payload()).channels[0].reconciliation).toEqual(reconciliation));
  it.each([
    { status: 'UNVERIFIED' }, { status: 'UNAVAILABLE' }, { currency: null },
    { window: { windowStatus: 'UNKNOWN', windowStart: null, windowEnd: null } },
    { gapDenominator: 'ACTUAL_REVENUE' }, { gapMinor: null }, { gapMinor: 0 },
    { windowCompatibility: 'INCOMPATIBLE' }, { gapPct: Infinity },
  ])('rejects contradictory published comparison %j', over => expect(BlendedTruthSchema.safeParse(payload(over)).success).toBe(false));
  it('rejects legacy shapes missing reconciliation', () => {
    const data = payload(); delete data.channels[0].reconciliation;
    expect(BlendedTruthSchema.safeParse(data).success).toBe(false);
  });
  it.each([0, 1, -1])('rejects an invented percentage %s for a zero platform denominator', gapPct => {
    const data = payload({ platformRevenueMinor: 0, actualRevenueMinor: 100, gapMinor: -100, gapPct });
    Object.assign(data.channels[0], { gapMinor: -100, gapPct });
    expect(BlendedTruthSchema.safeParse(data).success).toBe(false);
  });
  it('admits genuine zero and a valid zero-denominator absolute gap', () => {
    for (const comparison of [{ gapMinor: 0, gapPct: 0, platformRevenueMinor: 100, actualRevenueMinor: 100 },
      { gapMinor: -100, gapPct: null, platformRevenueMinor: 0, actualRevenueMinor: 100, gapPctReason: 'ZERO_PLATFORM_DENOMINATOR' }]) {
      const data = payload(comparison);
      Object.assign(data.channels[0], { gapMinor: comparison.gapMinor, gapPct: comparison.gapPct });
      expect(BlendedTruthSchema.safeParse(data).success).toBe(true);
    }
  });
  it('rejects disagreeing population counts', () => {
    const data = payload(); data.portfolio.totalChannelCount = 2;
    expect(BlendedTruthSchema.safeParse(data).success).toBe(false);
  });
});
