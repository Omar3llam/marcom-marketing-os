// ============================================================
// AllocationService + portfolio reconciliation — governance
// ============================================================
// Proves the Phase-3 allocation layer ties into existing governance:
//   1. Allocation moves become PROPOSED REALLOCATE Decisions whose
//      ActionType validates through the Meta confirm→execute guard.
//   2. The portfolio's per-channel spend reconciles to the underlying
//      MetricSnapshot rows — the CURRENT one per entity, summed across
//      entities (see the fixture note below).
// Pure helpers only — no DB required.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { planToDecisionRows } from './AllocationService.js';
import { allocate, GOAL_TYPE } from './allocationEngine.js';
import { buildChannelInputs }  from '../blended-truth/BlendedTruthService.js';
import { reconcile }           from '../blended-truth/blendedTruthEngine.js';
import { verdictToActionType } from '../verdict-engine/verdictTypes.js';
import { validateActionTarget } from '../metaExecutionService.js';

// Spend-window slice: a move is a Decision only when the plan says its spend
// period was MEASURABLE. This fixture is a measured plan; the refusal side is
// pinned in src/tests/spendWindowIntegrity.allocation.red.test.js.
function samplePlan() {
  return withMeasuredPeriod(allocate({
    totalBudgetMinor: 1_000_000,
    totalBudgetCurrency: 'USD',
    goal: { type: GOAL_TYPE.GROWTH_CEILING },
    channels: [
      { channelId: 'camp-a', blendedRoas: 3.2, currentSpendMinor: 400_000, verdict: 'SCALE', currency: 'USD', monetaryStatus: 'MONETARY_VALID' },
      { channelId: 'camp-b', blendedRoas: 0.8, currentSpendMinor: 600_000, verdict: 'KILL', currency: 'USD', monetaryStatus: 'MONETARY_VALID' },
    ],
  }));
}

const withMeasuredPeriod = (plan) => ({
  ...plan,
  monetaryStatus: 'MONETARY_VALID',
  spendPeriod: { status: 'MEASURABLE', reason: null, currency: 'USD', period: { start: '2026-08-01', end: '2026-08-31' } },
});

describe('AllocationService.planToDecisionRows — governance', () => {
  it('emits a PROPOSED REALLOCATE Decision per non-zero move, linked to its plan', () => {
    const rows = planToDecisionRows(samplePlan(), { workspaceId: 'ws1', planId: 'plan1' });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.verdict).toBe('REALLOCATE');
      expect(r.status).toBe('PROPOSED');
      expect(r.entityLevel).toBe('CAMPAIGN');
      expect(r.rootCause).toBe('allocation:plan1');
      expect(r.workspaceId).toBe('ws1');
    }
  });

  it('every emitted Decision validates through the Meta REALLOCATE_BUDGET guard', () => {
    const rows = planToDecisionRows(samplePlan(), { workspaceId: 'ws1', planId: 'plan1' });
    for (const r of rows) {
      const actionType = verdictToActionType(r.verdict, r.entityLevel);
      expect(actionType).toBe('REALLOCATE_BUDGET');
      // CAMPAIGN-level move → 'campaign' target validates; a bad target is rejected.
      expect(validateActionTarget(actionType, 'campaign')).toBe(true);
      expect(validateActionTarget(actionType, 'ad')).toBe(false);
    }
  });

  it('requires a workspaceId', () => {
    expect(() => planToDecisionRows(samplePlan(), { planId: 'p' })).toThrow(/workspaceId/);
  });
});

describe('portfolio reconciliation — totals == the CURRENT MetricSnapshot rows', () => {
  // FIXTURE PREMISE CORRECTED (#359). This case used to describe its two
  // same-entityId rows as "two leaf creative snapshots" that buildChannelInputs
  // rolled up into an account. It never did either of those things:
  //   - entityId is detId(workspaceId, channel, entityLevel, externalId), so two
  //     distinct creative leaves CANNOT share one entityId. Two rows with the
  //     same entityId are the same entity, synced twice.
  //   - buildChannelInputs groups BY entityId; it has no parent/child notion and
  //     never rolls a leaf into an account.
  // So the old 84,310 was not a rollup — it was one entity's trailing-window
  // spend added to itself. The rows below now say what they always were: two
  // syncs, the later superseding the earlier.
  //
  // Every asserted NUMBER is unchanged on purpose. What changed is where 84,310
  // comes from: it is now the current reading, not the sum of two.
  it('per-channel blended spend is the entity\'s newest platform snapshot', () => {
    const D1 = new Date('2026-08-01T09:00:00Z');
    const D2 = new Date('2026-08-02T09:00:00Z');
    const snapshots = [
      { entityId: 'acct-a', source: 'META', date: D1, spendMinor: 50_000, revenueMinor: 30_000 },
      { entityId: 'acct-a', source: 'META', date: D2, spendMinor: 84_310, revenueMinor: 50_586 },
      { entityId: 'acct-a', source: 'GA4',  date: D2, spendMinor: 0,      revenueMinor: 38_000 }, // actual
      { entityId: 'acct-b', source: 'SNAP', date: D1, spendMinor: 30_000, revenueMinor: 27_000 },
      { entityId: 'acct-b', source: 'SNAP', date: D2, spendMinor: 52_400, revenueMinor: 47_160 },
    ];
    const channels = buildChannelInputs(snapshots.map((s) => ({ ...s, currency: 'USD', currencyProvenance: 'PLATFORM_REPORTED' })));
    const { channels: rows, portfolio } = reconcile({ channels });

    const a = rows.find((c) => c.channelId === 'acct-a');
    const b = rows.find((c) => c.channelId === 'acct-b');

    expect(a.spendMinor).toBe(84_310);             // D2's reading, NOT 50,000 + 84,310
    expect(a.coverage).toBe('RECONCILED');         // GA4 actual present
    expect(a.blendedRevenueMinor).toBe(38_000);    // uses the actual, not 50,586 platform
    expect(b.spendMinor).toBe(52_400);
    expect(b.coverage).toBe('UNVERIFIED');         // no actual on B

    // Portfolio spend still SUMS — but across channels, which is valid, rather
    // than across one channel's repeat syncs, which is not.
    const currentPlatformSpend = 84_310 + 52_400;
    expect(portfolio.spendMinor).toBe(currentPlatformSpend); // 136,710
  });
});
