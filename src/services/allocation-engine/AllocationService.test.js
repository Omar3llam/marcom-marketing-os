// ============================================================
// AllocationService + portfolio reconciliation — governance
// ============================================================
// Proves the Phase-3 allocation layer ties into existing governance:
//   1. Allocation moves become PROPOSED REALLOCATE Decisions whose
//      ActionType validates through the Meta confirm→execute guard.
//   2. The portfolio's per-channel spend reconciles to the sum of the
//      underlying MetricSnapshot rows (== the Phase-1 entity rollup).
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
import { rollup }              from '../../lib/money.js';

function samplePlan() {
  return allocate({
    totalBudgetMinor: 1_000_000,
    goal: { type: GOAL_TYPE.GROWTH_CEILING },
    channels: [
      { channelId: 'camp-a', blendedRoas: 3.2, currentSpendMinor: 400_000, verdict: 'SCALE' },
      { channelId: 'camp-b', blendedRoas: 0.8, currentSpendMinor: 600_000, verdict: 'KILL' },
    ],
  });
}

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

describe('portfolio reconciliation — totals == sum of MetricSnapshot rows', () => {
  it('per-channel blended spend equals the rollup of the leaf snapshots', () => {
    // Two channels (accounts), each with two leaf creative snapshots + a GA4 actual
    // on channel A only. Platform-source rows carry spend; GA4 carries actual revenue.
    const snapshots = [
      { entityId: 'acct-a', source: 'META', spendMinor: 50_000, revenueMinor: 30_000 },
      { entityId: 'acct-a', source: 'META', spendMinor: 34_310, revenueMinor: 20_586 },
      { entityId: 'acct-a', source: 'GA4',  spendMinor: 0,      revenueMinor: 38_000 }, // actual
      { entityId: 'acct-b', source: 'SNAP', spendMinor: 30_000, revenueMinor: 27_000 },
      { entityId: 'acct-b', source: 'SNAP', spendMinor: 22_400, revenueMinor: 20_160 },
    ];
    const channels = buildChannelInputs(snapshots);
    const { channels: rows, portfolio } = reconcile({ channels });

    const a = rows.find((c) => c.channelId === 'acct-a');
    const b = rows.find((c) => c.channelId === 'acct-b');

    // Channel A spend reconciles to the rollup of its platform leaves.
    const aRollup = rollup({ children: [{ spendMinor: 50_000 }, { spendMinor: 34_310 }] });
    expect(a.spendMinor).toBe(aRollup.spendMinor); // 84,310
    expect(a.coverage).toBe('RECONCILED');         // GA4 actual present
    expect(a.blendedRevenueMinor).toBe(38_000);    // uses the actual, not 50,586 platform
    expect(b.coverage).toBe('UNVERIFIED');         // no actual on B

    // Portfolio spend == sum of every platform snapshot's spend.
    const totalSpend = snapshots.filter((s) => s.source !== 'GA4').reduce((s2, r) => s2 + r.spendMinor, 0);
    expect(portfolio.spendMinor).toBe(totalSpend); // 136,710
  });
});
