import { describe, expect, it } from 'vitest';
import { BlendedTruthSchema } from './blendedTruth.schema';
import { AllocationPlanPreviewSchema } from './allocationPlan.schema';
import { NorthStarGoalSchema, PlanProjectionsSchema } from './plan.schema';
const unverified = { status: 'UNVERIFIED', reason: 'ACTUAL_REVENUE_UNAVAILABLE', windowCompatibility: 'UNKNOWN',
  window: { windowStatus: 'UNKNOWN', windowStart: null, windowEnd: null }, currency: null,
  platformRevenueMinor: null, actualRevenueMinor: null, gapMinor: null, gapPct: null, gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE' };

const channel = (currency: string | null, monetaryStatus: string, monetaryReason: string | null) => ({
  channelId: 'meta', channel: 'META', name: 'Prospecting', currency, monetaryStatus, monetaryReason,
  spendMinor: currency ? 10000 : null,
  platformRevenueMinor: currency ? 20000 : null,
  actualRevenueMinor: null,
  blendedRevenueMinor: currency ? 20000 : null,
  gapMinor: null,
  gapPct: null,
  reconciliation: unverified,
  platformRoas: currency ? 2 : null,
  blendedRoas: currency ? 2 : null,
  coverage: 'UNVERIFIED', confidence: 'LOW',
});

const portfolio = (currency: string | null, monetaryStatus: string, monetaryReason: string | null) => ({
  currency, monetaryStatus, monetaryReason,
  spendMinor: currency ? 10000 : null,
  platformRevenueMinor: currency ? 20000 : null,
  blendedRevenueMinor: currency ? 20000 : null,
  gapMinor: null,
  gapPct: null,
  reconciliation: { ...unverified, reconciledCount: 0, unverifiedCount: 1, unavailableCount: 0, totalChannelCount: 1 },
  platformRoas: currency ? 2 : null,
  blendedRoas: currency ? 2 : null,
  reconciledCount: 0, unverifiedCount: 1, unavailableCount: 0, totalChannelCount: 1,
});

describe('operational monetary frontend schemas', () => {
  it('keeps legacy Plan JSON readable without promoting old mer keys', () => {
    const parsed = PlanProjectionsSchema.parse({
      scenario: { scenarioType: 'BUDGET_EXPANSION', projections: {
        blendedCacMinor: { low: null, expected: null, high: null },
        volume: { low: null, expected: null, high: null },
        revenueMinor: { low: null, expected: null, high: null },
        grossProfitMinor: { low: null, expected: null, high: null },
        merAfter: { low: 2, expected: 2.5, high: 3 },
      }, assumptions: [], confidence: 0.5, basis: 'legacy' },
      economics: null, goalLanding: null,
      mix: { projected: { blendedRevenueMinor: 100, projectedCpaMinor: null, merBefore: 2, merAfter: 2.5 } },
    });
    expect(parsed.scenario?.projections).toHaveProperty('merAfter');
    expect(parsed.mix?.efficiencyStatus).toBeUndefined();
  });
  it.each(['EGP', 'USD', 'SAR'])('retains proven %s from the backend portfolio', (currency) => {
    const parsed = BlendedTruthSchema.parse({
      channels: [channel(currency, 'MONETARY_VALID', null)],
      portfolio: portfolio(currency, 'MONETARY_VALID', null),
    });
    expect(parsed.portfolio.currency).toBe(currency);
    expect(parsed.portfolio.monetaryStatus).toBe('MONETARY_VALID');
  });

  it.each(['SPEND_CURRENCY_MIXED', 'SPEND_CURRENCY_UNTRUSTED'])('preserves nullable money and %s', (reason) => {
    const status = reason === 'SPEND_CURRENCY_MIXED' ? 'MONETARY_UNAVAILABLE_MIXED' : 'MONETARY_UNAVAILABLE_UNTRUSTED';
    const parsed = BlendedTruthSchema.parse({
      channels: [channel(null, status, reason)], portfolio: portfolio(null, status, reason),
    });
    expect(parsed.portfolio.currency).toBeNull();
    expect(parsed.portfolio.spendMinor).toBeNull();
    expect(parsed.portfolio.monetaryReason).toBe(reason);
    expect(parsed.channels[0].monetaryReason).toBe(reason);
  });

  it('accepts a monetary-unavailable allocation preview without converting nulls', () => {
    const parsed = AllocationPlanPreviewSchema.parse({
      goal: { type: 'GROWTH_CEILING', value: null }, totalBudgetMinor: 10000,
      basis: 'blended',
      currency: null, monetaryStatus: 'MONETARY_UNAVAILABLE_MIXED', monetaryReason: 'SPEND_CURRENCY_MIXED',
      efficiencyStatus: 'UNAVAILABLE', efficiencyReason: 'CURRENCY_UNTRUSTED',
      spendPeriod: null,
      allocations: [{ channelId: 'meta', channel: 'META', verdict: 'HOLD', currentSpendMinor: null,
        recommendedSpendMinor: null, deltaMinor: null, blendedRoas: null, rationale: 'unavailable' }],
      projected: { blendedRevenueMinor: null, projectedCpaMinor: null, blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
      reasoningTrail: ['unavailable'],
    });
    expect(parsed.currency).toBeNull();
    expect(parsed.allocations[0].recommendedSpendMinor).toBeNull();
    expect(parsed.monetaryReason).toBe('SPEND_CURRENCY_MIXED');
  });

  it('does not supply USD to a persisted goal missing its denomination', () => {
    const parsed = NorthStarGoalSchema.safeParse({
      id: 'goal-1', workspaceId: 'ws-1', name: 'Target', metric: 'blendedRoas',
      comparator: 'GTE', targetValue: 2, periodStart: '2026-09-01', periodEnd: '2026-09-30',
      status: 'ON_TRACK', planId: null,
    });
    expect(parsed.success).toBe(false);
  });
});
