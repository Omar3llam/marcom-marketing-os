// ============================================================
// C-18 · promotePlanMix — one act, named, timed, and done once
// ------------------------------------------------------------
// C-18 already joins the artifact and Plan writes in one transaction. T1
// protects the preceding approval/repeat/snapshot reads with a parent-row lock
// too: concurrent callers must not both pass a pre-transaction guard.
//
// This suite pins the four rulings at the service seam: the mix comes from the
// snapshot (A), who and when are recorded (B), and the outcome is named rather
// than inferred from a count (I-18.5).
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';

vi.mock('../../lib/prisma.js', () => {
  const plan = { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() };
  const allocationPlan = { create: vi.fn() };
  const decision = { createMany: vi.fn() };
  const tx = { plan, allocationPlan, decision, $queryRaw: vi.fn() };
  return {
    prisma: {
      ...tx,
      northStarGoal: { create: vi.fn() },
      $transaction: vi.fn(async (arg) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
    },
  };
});
vi.mock('../allocation-engine/AllocationService.js', () => ({
  previewAllocation: vi.fn(),
  commitAllocation:  vi.fn(),
  persistAllocation: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { previewAllocation, commitAllocation, persistAllocation } from '../allocation-engine/AllocationService.js';
import { promotePlanMix } from './PlanService.js';
import { captureMixSnapshot, PROMOTION_REFUSAL } from './planPromotionSnapshot.js';

const WS = 'workspace-1';
const ACTOR = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-04T10:00:00.000Z');

// Spend-window slice: promotion stages moves only from a mix whose spend period
// was MEASURABLE. These C-18 rulings are about a measured mix; the unmeasured
// and legacy cases are pinned in src/tests/spendWindowIntegrity.promotion.red.test.js.
const mixPreview = (deltas = [200_000, -200_000]) => ({
  goal: { type: 'GROWTH_CEILING', value: null },
  spendPeriod: { status: 'MEASURABLE', reason: null, currency: 'USD', period: { start: '2026-08-01', end: '2026-08-31' } },
  totalBudgetMinor: 1_000_000,
  currency: 'USD',
  monetaryStatus: 'MONETARY_VALID',
  monetaryReason: null,
  efficiencyStatus: 'VALID', efficiencyReason: null,
  allocations: deltas.map((d, i) => ({
    channelId: `ch-${i}`, channel: 'META', verdict: 'SCALE',
    currentSpendMinor: 500_000, recommendedSpendMinor: 500_000 + d, deltaMinor: d,
    blendedRoas: 2, rationale: 'because',
  })),
  projected: { blendedRevenueMinor: 2_000_000, projectedCpaMinor: 3_000, blendedRevenueEfficiencyBefore: 1.7, blendedRevenueEfficiencyAfter: 2 },
  reasoningTrail: ['ceiling 10,000.00 USD'],
});

const row = (over = {}) => {
  const mix = mixPreview();
  return {
    id: 'plan-1', workspaceId: WS,
    totalBudgetMinor: mix.totalBudgetMinor, currency: mix.currency,
    channelMix: mix.allocations,
    projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(mix) },
    status: 'DRAFT',
    requiresApproval: false, approvalState: null,
    allocationPlanId: null, promotedAt: null, promotedBy: null, closedAt: null,
    ...over,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ id: 'plan-1' }]);
  prisma.plan.update.mockResolvedValue({});
  persistAllocation.mockResolvedValue({ allocationPlanId: 'alloc-1', decisionsCreated: 2 });
});

describe('Ruling A — the approved mix is what is promoted', () => {
  it('never reaches the recompute path', async () => {
    prisma.plan.findFirst.mockResolvedValue(row());

    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    // The three sites Ruling A named: "ممنوع: read only totalBudgetMinor →
    // re-run getBlendedTruth → use latest verdicts → build a new mix".
    expect(previewAllocation).not.toHaveBeenCalled();
    expect(commitAllocation).not.toHaveBeenCalled();
  });

  it('hands the stored allocations to the persist step, byte for byte', async () => {
    const stored = row();
    prisma.plan.findFirst.mockResolvedValue(stored);

    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    const [, , commit] = persistAllocation.mock.calls[0];
    expect(commit.allocations).toEqual(stored.channelMix);
    expect(commit.projected).toEqual(stored.projections.mix.projected);
    expect(commit.reasoningTrail).toEqual(stored.projections.mix.reasoningTrail);
  });

  it('refuses a plan whose snapshot predates the contract, without recomputing', async () => {
    prisma.plan.findFirst.mockResolvedValue(row({ projections: { scenario: null, economics: null, goalLanding: null } }));

    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE });

    expect(previewAllocation).not.toHaveBeenCalled();
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });
});

describe('Ruling B — who, and when', () => {
  it('records the promoter and the moment, alongside the status flip', async () => {
    prisma.plan.findFirst.mockResolvedValue(row());

    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(prisma.plan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { allocationPlanId: 'alloc-1', status: 'ACTIVE', promotedAt: NOW, promotedBy: ACTOR },
    });
  });

  it('refuses an unresolvable actor rather than writing null into the column', async () => {
    // R-13, as C-05 settled it: an act nobody can be named for is not the act.
    prisma.plan.findFirst.mockResolvedValue(row());

    await expect(promotePlanMix(WS, 'plan-1', { promotedById: null, now: NOW }))
      .rejects.toMatchObject({ code: PROMOTION_REFUSAL.ACTOR_UNRESOLVED });

    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('puts every write inside ONE transaction', async () => {
    // Keep C-18's atomic-write contract while adding protected state reads.
    prisma.plan.findFirst.mockResolvedValue(row());

    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // interactive form — a callback, so every write shares one client
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
    // and the persist step runs on THAT client, not the ambient one
    const [txArg] = persistAllocation.mock.calls[0];
    expect(txArg).not.toBe(prisma);
    expect(txArg.allocationPlan).toBeDefined();
  });
});

describe('I-18.5 — the outcome is named, not inferred from a count', () => {
  it('PROMOTED when the approved mix asks for moves', async () => {
    prisma.plan.findFirst.mockResolvedValue(row());

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(res).toMatchObject({
      outcome: PROMOTION_OUTCOME.PROMOTED,
      decisionsCreated: 2, allocationPlanId: 'alloc-1', promotedAt: NOW,
    });
  });

  it('PROMOTED_WITH_NO_MOVES when the approved mix matches current spend', async () => {
    // A real promotion. There is simply nothing to confirm — which is why the
    // client must not print "Confirm them in Decisions to execute".
    const mix = mixPreview([0, 0]);
    prisma.plan.findFirst.mockResolvedValue(row({
      channelMix: mix.allocations,
      projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(mix) },
    }));

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(res.outcome).toBe(PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
    expect(res.decisionsCreated).toBe(0);
  });

  it('writes NO AllocationPlan row when there are no moves', async () => {
    // An AllocationPlan is published by /lumi/feed as "open, awaiting human
    // confirm". A row with nothing in it to confirm is a claim about work that
    // does not exist.
    const mix = mixPreview([0, 0]);
    prisma.plan.findFirst.mockResolvedValue(row({
      channelMix: mix.allocations,
      projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(mix) },
    }));

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(persistAllocation).not.toHaveBeenCalled();
    expect(res.allocationPlanId).toBeNull();
  });

  it('still records the promotion when there were no moves', async () => {
    // The plan IS in force. Without promotedAt nothing would remember that, and
    // the next call would promote it all over again.
    const mix = mixPreview([0, 0]);
    prisma.plan.findFirst.mockResolvedValue(row({
      channelMix: mix.allocations,
      projections: { scenario: null, economics: null, goalLanding: null, mix: captureMixSnapshot(mix) },
    }));

    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(prisma.plan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { allocationPlanId: null, status: 'ACTIVE', promotedAt: NOW, promotedBy: ACTOR },
    });
  });

  it('ALREADY_PROMOTED reports the original moment and creates nothing', async () => {
    const first = new Date('2026-09-01T08:00:00.000Z');
    prisma.plan.findFirst.mockResolvedValue(row({
      status: 'ACTIVE', allocationPlanId: 'alloc-1', promotedAt: first, promotedBy: ACTOR,
    }));

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(res).toMatchObject({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, decisionsCreated: 0, promotedAt: first });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('guards on promotedAt, not on allocationPlanId', async () => {
    // The zero-move promotion leaves allocationPlanId null. Guarding on it would
    // let that plan be promoted a second time — which is why Ruling B's column
    // is load-bearing rather than decorative.
    prisma.plan.findFirst.mockResolvedValue(row({
      status: 'ACTIVE', allocationPlanId: null, promotedAt: new Date('2026-09-01T08:00:00.000Z'),
    }));

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(res.outcome).toBe(PROMOTION_OUTCOME.ALREADY_PROMOTED);
    expect(persistAllocation).not.toHaveBeenCalled();
  });

  it('still recognises a plan promoted BEFORE this slice, which has no promotedAt', async () => {
    // Legacy trace: allocationPlanId set, promotedAt null. Both mean promoted;
    // one is the record and one is all that was left behind.
    prisma.plan.findFirst.mockResolvedValue(row({ status: 'ACTIVE', allocationPlanId: 'alloc-old', promotedAt: null }));

    const res = await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(res).toMatchObject({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, allocationPlanId: 'alloc-old', promotedAt: null });
    expect(persistAllocation).not.toHaveBeenCalled();
  });
});

describe('the approval gate still arbitrates, and now it can actually be armed', () => {
  it('checks approval against the protected transaction state, not an earlier read', async () => {
    prisma.plan.findFirst.mockResolvedValue(row());
    prisma.$transaction.mockImplementationOnce(async (callback) => {
      prisma.plan.findFirst.mockResolvedValue(row({ requiresApproval: true, approvalState: 'PENDING' }));
      return callback({ ...prisma });
    });

    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: 'ApprovalRequired' });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('locks by workspace and id before its authoritative read under READ COMMITTED', async () => {
    prisma.plan.findFirst.mockResolvedValue(row());
    await promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [parts, id, workspace] = prisma.$queryRaw.mock.calls[0];
    expect(parts.join('?')).toMatch(/SELECT id FROM plans.*WHERE id = \?::uuid AND "workspaceId" = \?::uuid FOR UPDATE/s);
    expect([id, workspace]).toEqual(['plan-1', WS]);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.plan.findFirst.mock.invocationCallOrder[0]);
  });

  it('refuses a missing scoped lock before reading a Plan or creating artifacts', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.plan.findFirst.mockResolvedValue(row());
    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toThrow('promotePlanMix: plan not found');
    expect(prisma.plan.findFirst).not.toHaveBeenCalled();
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('keeps approval ahead of repeat recognition, and repeat ahead of actor and snapshot refusal', async () => {
    prisma.plan.findFirst.mockResolvedValue(row({ requiresApproval: true, approvalState: 'PENDING',
      promotedAt: NOW, projections: {} }));
    await expect(promotePlanMix(WS, 'plan-1', { promotedById: null }))
      .rejects.toMatchObject({ code: 'ApprovalRequired' });

    prisma.plan.findFirst.mockResolvedValue(row({ promotedAt: NOW, projections: {} }));
    expect(await promotePlanMix(WS, 'plan-1', { promotedById: null }))
      .toMatchObject({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, promotedAt: NOW });
    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('refuses a plan whose gate is open and unapproved', async () => {
    prisma.plan.findFirst.mockResolvedValue(row({ requiresApproval: true, approvalState: 'PENDING' }));

    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: 'ApprovalRequired' });

    expect(persistAllocation).not.toHaveBeenCalled();
    expect(prisma.plan.update).not.toHaveBeenCalled();
  });

  it('checks the gate BEFORE resolving the snapshot', async () => {
    // A blocked plan must answer "you need approval", never "your snapshot is
    // too old" — the second would send a strategist to rebuild a plan they are
    // not yet permitted to promote.
    prisma.plan.findFirst.mockResolvedValue(row({
      requiresApproval: true, approvalState: 'PENDING',
      projections: { scenario: null, economics: null, goalLanding: null },
    }));

    await expect(promotePlanMix(WS, 'plan-1', { promotedById: ACTOR, now: NOW }))
      .rejects.toMatchObject({ code: 'ApprovalRequired' });
  });
});
