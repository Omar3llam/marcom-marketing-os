// ============================================================
// Spend-Window Integrity · RED — PLANS
// ------------------------------------------------------------
// A plan has its own period (periodStart → periodEnd), so it is the one budget
// whose period is already written down. Two things must hold:
//
//   1. buildPlan asks for a mix over THAT period — not over "this month" and not
//      over whatever the last sync fetched.
//   2. Promotion only stages moves that were measured. C-18 promotes the mix a
//      strategist approved, verbatim — which is exactly why a mix whose moves
//      were never measured must not become Decisions now. And it must not be
//      reported as PROMOTED_WITH_NO_MOVES, whose copy tells the operator their
//      mix "already matches what you are spending". That is a claim about spend
//      nobody measured.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as contracts from '@marcom/runtime-contracts';

vi.mock('../lib/prisma.js', () => {
  const plan = { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(async () => ({ id: 'plan-new' })), findMany: vi.fn(async () => []) };
  const allocationPlan = { create: vi.fn() };
  const decision = { createMany: vi.fn() };
  const tx = { plan, allocationPlan, decision };
  return {
    prisma: {
      ...tx,
      northStarGoal: { create: vi.fn() },
      $transaction: vi.fn(async (arg) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
    },
  };
});
vi.mock('../services/allocation-engine/AllocationService.js', () => ({
  previewAllocation: vi.fn(),
  commitAllocation: vi.fn(),
  persistAllocation: vi.fn(),
}));
vi.mock('../services/test-generator/TestGeneratorService.js', () => ({
  getWeeklyAgenda: vi.fn(async () => []),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { prisma } = await import('../lib/prisma.js');
const { previewAllocation, persistAllocation } = await import('../services/allocation-engine/AllocationService.js');
const { promotePlanMix, buildPlan } = await import('../services/planning/PlanService.js');
const { captureMixSnapshot } = await import('../services/planning/planPromotionSnapshot.js');

const WS = 'workspace-1';
const ACTOR = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-13T10:00:00.000Z');
const NOT_MEASURABLE_OUTCOME = 'PROMOTED_MOVES_NOT_MEASURABLE';

const mix = ({ deltas, spendPeriod }) => ({
  goal: { type: 'GROWTH_CEILING', value: null },
  totalBudgetMinor: 1_000_000,
  currency: spendPeriod?.status === 'MEASURABLE' ? 'USD' : null,
  monetaryStatus: spendPeriod?.status === 'MEASURABLE' ? 'MONETARY_VALID' : 'MONETARY_UNAVAILABLE_UNTRUSTED',
  monetaryReason: spendPeriod?.status === 'MEASURABLE' ? null : spendPeriod?.reason ?? 'WINDOW_UNKNOWN',
  ...(spendPeriod === undefined ? {} : { spendPeriod }),
  allocations: deltas.map((d, i) => ({
    channelId: `ch-${i}`, channel: 'META', verdict: 'HOLD', blendedRoas: 2,
    currentSpendMinor: d == null ? null : 500_000,
    recommendedSpendMinor: d == null ? null : 500_000 + d,
    deltaMinor: d, rationale: 'because',
  })),
  projected: { blendedRevenueMinor: null, projectedCpaMinor: null, merBefore: null, merAfter: null },
  reasoningTrail: ['a trail'],
});

const planRow = (m) => ({
  id: 'plan-1', workspaceId: WS,
  totalBudgetMinor: m.totalBudgetMinor, currency: 'USD',
  channelMix: m.allocations,
  projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(m) },
  status: 'DRAFT', requiresApproval: false, approvalState: null,
  allocationPlanId: null, promotedAt: null, promotedBy: null, closedAt: null,
});

const MEASURED = { status: 'MEASURABLE', reason: null, currency: 'USD', period: { start: '2026-08-01', end: '2026-08-31' } };
const UNMEASURED = { status: 'NOT_MEASURABLE', reason: 'WINDOW_MISMATCH', period: { start: '2026-10-01', end: '2026-10-31' } };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.plan.update.mockResolvedValue({});
  persistAllocation.mockResolvedValue({ allocationPlanId: 'alloc-1', decisionsCreated: 2 });
});

describe('the contract names what happened', () => {
  it('PROMOTION_OUTCOME declares a distinct outcome for unmeasured moves', () => {
    expect(contracts.PROMOTION_OUTCOME[NOT_MEASURABLE_OUTCOME]).toBe(NOT_MEASURABLE_OUTCOME);
    expect(contracts.isPromotionOutcome(NOT_MEASURABLE_OUTCOME)).toBe(true);
  });
});

describe('buildPlan asks for a mix over the plan\'s own period', () => {
  it('passes periodStart → periodEnd, as days, to the allocation preview', async () => {
    previewAllocation.mockResolvedValue(mix({ deltas: [null, null], spendPeriod: UNMEASURED }));
    await buildPlan(WS, {
      name: 'October', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      totalBudgetMinor: 1_000_000, totalBudgetCurrency: 'USD', now: NOW,
    }).catch(() => null); // the read-back after persistence is not what this case measures

    expect(previewAllocation).toHaveBeenCalled();
    const [, opts] = previewAllocation.mock.calls[0];
    expect(opts.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('records the spend period in the snapshot promotion reads', () => {
    const snap = captureMixSnapshot(mix({ deltas: [null], spendPeriod: UNMEASURED }));
    expect(snap.spendPeriod).toEqual(UNMEASURED);
  });
});

describe('promotion stages only measured moves', () => {
  it('a mix whose moves were NOT measurable refuses promotion without writes', async () => {
    prisma.plan.findFirst.mockResolvedValue(planRow(mix({ deltas: [null, null], spendPeriod: UNMEASURED })));
    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: 'PlanMonetaryUnavailable', reason: 'WINDOW_MISMATCH' });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('a mix approved BEFORE spend periods were recorded is not a measured mix', async () => {
    // Numeric deltas, no spendPeriod: every plan in the database today.
    prisma.plan.findFirst.mockResolvedValue(planRow(mix({ deltas: [-60_000, -60_000], spendPeriod: undefined })));
    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: 'PlanMonetaryUnavailable' });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('control — a measured mix with moves is still PROMOTED', async () => {
    prisma.plan.findFirst.mockResolvedValue(planRow(mix({ deltas: [200_000, -200_000], spendPeriod: MEASURED })));
    const out = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });
    expect(persistAllocation).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe(contracts.PROMOTION_OUTCOME.PROMOTED);
  });

  it('control — a measured mix that asks for nothing is still PROMOTED_WITH_NO_MOVES', async () => {
    prisma.plan.findFirst.mockResolvedValue(planRow(mix({ deltas: [0, 0], spendPeriod: MEASURED })));
    const out = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(out.outcome).toBe(contracts.PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
  });
});
