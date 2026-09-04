// ============================================================
// C-18 · administrative closure — time may end a period, and claim nothing else
// ------------------------------------------------------------
// `PlanStatus.CLOSED` has ZERO writers on master. No worker, no cron, and
// nothing anywhere reads `periodEnd` to end a plan. So a plan whose period
// finished six months ago is still ACTIVE, and is still what feed.js and
// AgenticLoopService call "the active plan" — indistinguishable from one that
// is actually in force.
//
// Ruling D draws the line this sweep may not cross:
//
//   periodEnd passes  →  CLOSED + closedAt          ← a lifecycle fact
//   periodEnd passes  →  ACHIEVED / MISSED          ← a claim about learning
//
// The second needs a producer that owns evidence. A clock is not one. This is
// Invariant 13 in a new place: an administrative close must never write a
// result that enters learning.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    plan:           { updateMany: vi.fn() },
    northStarGoal:  { updateMany: vi.fn(), update: vi.fn() },
    allocationPlan: { updateMany: vi.fn(), update: vi.fn() },
    decision:       { updateMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { runPlanClosureSweep } from './planClosureSweep.js';

const NOW = new Date('2026-09-04T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  prisma.plan.updateMany.mockResolvedValue({ count: 3 });
});

describe('what the sweep closes', () => {
  it('closes ACTIVE plans whose period has ended, and stamps when', async () => {
    await runPlanClosureSweep({ now: NOW });

    expect(prisma.plan.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', periodEnd: { lt: NOW }, closedAt: null },
      data:  { status: 'CLOSED', closedAt: NOW },
    });
  });

  it('leaves DRAFT alone — Ruling D drew ACTIVE → CLOSED, and only that', async () => {
    await runPlanClosureSweep({ now: NOW });

    const { where } = prisma.plan.updateMany.mock.calls[0][0];
    expect(where.status).toBe('ACTIVE');
    expect(where.status).not.toEqual({ in: ['ACTIVE', 'DRAFT'] });
  });

  it('is idempotent — a second run over the same rows closes nothing new', async () => {
    // `closedAt: null` in the predicate, not just `status: ACTIVE`. Without it a
    // re-run would re-stamp closedAt and move a recorded moment.
    await runPlanClosureSweep({ now: NOW });
    expect(prisma.plan.updateMany.mock.calls[0][0].where.closedAt).toBeNull();
  });

  it('reports how many it closed, rather than succeeding silently', async () => {
    // Same reasoning as its neighbours on the maintenance queue: a sweep that
    // quietly did nothing is indistinguishable from one that worked.
    await expect(runPlanClosureSweep({ now: NOW })).resolves.toEqual({ closed: 3 });
  });

  it('runs one statement, not a per-workspace fan-out', async () => {
    await runPlanClosureSweep({ now: NOW });
    expect(prisma.plan.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('what the sweep must never claim', () => {
  it('writes no goal outcome — a clock cannot know a target was met', async () => {
    await runPlanClosureSweep({ now: NOW });

    expect(prisma.northStarGoal.updateMany).not.toHaveBeenCalled();
    expect(prisma.northStarGoal.update).not.toHaveBeenCalled();
  });

  it('writes no allocation outcome — ACCEPTED/REJECTED need a person or evidence', async () => {
    await runPlanClosureSweep({ now: NOW });

    expect(prisma.allocationPlan.updateMany).not.toHaveBeenCalled();
    expect(prisma.allocationPlan.update).not.toHaveBeenCalled();
  });

  it('touches no Decision at all — closure must not enter the learning population', async () => {
    // Invariant 13, as C-05 settled it: an administrative close that writes
    // `resolution` enters calibration as a SUCCESS nobody claimed.
    await runPlanClosureSweep({ now: NOW });

    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('writes exactly two fields onto the plan, and no third', async () => {
    await runPlanClosureSweep({ now: NOW });

    const { data } = prisma.plan.updateMany.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['closedAt', 'status']);
  });
});
