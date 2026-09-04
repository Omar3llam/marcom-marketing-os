// ============================================================
// C-18 · POST /plans/:id/promote — what crosses the wire
// ------------------------------------------------------------
// Master answers a promotion with a count and a flag:
//
//   { planId, allocationPlanId, decisionsCreated }
//   { planId, allocationPlanId, decisionsCreated: 0, alreadyPromoted: true }
//
// `alreadyPromoted` has ZERO readers — backend or client. So the second shape
// reaches PlansPanel as the first, and it prints:
//
//   "Promoted — 0 proposed moves. Confirm them in Decisions to execute."
//
// which is not silence about an absence. It is an instruction to go somewhere
// and confirm nothing — the sharper form of the defect C-07 measured.
// ============================================================
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';

vi.mock('../../services/planning/PlanService.js', () => ({
  buildPlan: vi.fn(), listPlans: vi.fn(), getPlan: vi.fn(), promotePlanMix: vi.fn(),
}));
vi.mock('../../services/scenario-engine/ScenarioService.js', () => ({ runScenario: vi.fn() }));
vi.mock('../../services/unit-economics/EconomicsService.js', () => ({
  getEconomicsAssessment: vi.fn(), setEconomics: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() }, northStarGoal: { findMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { planningRouter } from './planning.js';
import { prisma } from '../../lib/prisma.js';
import { promotePlanMix } from '../../services/planning/PlanService.js';
import { PROMOTION_REFUSAL } from '../../services/planning/planPromotionSnapshot.js';

const FIREBASE_UID = 'aZ9kQ2mV7pLx3Rt8Nw1Ye5Bc0Df4';
const USER_ID      = '11111111-1111-1111-1111-111111111111';

let priorPlanOverride;
beforeAll(() => { priorPlanOverride = process.env.PLAN_OVERRIDE; process.env.PLAN_OVERRIDE = 'PRO'; });
afterAll(() => {
  if (priorPlanOverride === undefined) delete process.env.PLAN_OVERRIDE;
  else process.env.PLAN_OVERRIDE = priorPlanOverride;
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = FIREBASE_UID;
    req.workspaceId = 'workspace-1';
    req.collabRole = 'STRATEGIST';
    next();
  });
  app.use('/', planningRouter);
  return app;
}

const refuse = (code, message) => Object.assign(new Error(message), { code });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ id: USER_ID });
});

describe('the promoter is a person, and the route names them', () => {
  it('resolves the Firebase uid to a User row before promoting', async () => {
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: 'alloc-1', decisionsCreated: 2,
      outcome: PROMOTION_OUTCOME.PROMOTED, promotedAt: new Date('2026-09-04T10:00:00.000Z'),
    });

    await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(201);

    const [, , opts] = promotePlanMix.mock.calls[0];
    expect(opts.promotedById).toBe(USER_ID);
    expect(opts.promotedById).not.toBe(FIREBASE_UID);
  });

  it('refuses 409 when the caller cannot be resolved to a User row', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(409);

    expect(res.body.error).toBe('ActorUnresolved');
    expect(promotePlanMix).not.toHaveBeenCalled();
  });
});

describe('the outcome crosses the wire', () => {
  it('publishes the named outcome, not just a count', async () => {
    const at = new Date('2026-09-04T10:00:00.000Z');
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: 'alloc-1', decisionsCreated: 2,
      outcome: PROMOTION_OUTCOME.PROMOTED, promotedAt: at,
    });

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(201);

    expect(res.body).toMatchObject({
      workspaceId: 'workspace-1', planId: 'plan-1',
      outcome: PROMOTION_OUTCOME.PROMOTED, decisionsCreated: 2,
      promotedAt: at.toISOString(),
    });
  });

  it('carries PROMOTED_WITH_NO_MOVES through instead of collapsing it to a zero', async () => {
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: null, decisionsCreated: 0,
      outcome: PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES, promotedAt: new Date(),
    });

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(201);

    expect(res.body.outcome).toBe(PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
    expect(res.body.allocationPlanId).toBeNull();
  });

  it('carries ALREADY_PROMOTED and the moment it first happened', async () => {
    const first = new Date('2026-09-01T08:00:00.000Z');
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: 'alloc-1', decisionsCreated: 0,
      outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, promotedAt: first,
    });

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(200);

    expect(res.body).toMatchObject({
      outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, promotedAt: first.toISOString(),
    });
  });

  it('answers 200 for a repeat and 201 only when something was created', async () => {
    // A 201 says "created". Nothing was. The status line is part of the answer.
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: 'alloc-1', decisionsCreated: 0,
      outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, promotedAt: new Date(),
    });
    await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(200);
  });

  it('never publishes the flag nobody read', async () => {
    promotePlanMix.mockResolvedValue({
      planId: 'plan-1', allocationPlanId: 'alloc-1', decisionsCreated: 0,
      outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, promotedAt: new Date(),
    });

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({});
    expect(res.body).not.toHaveProperty('alreadyPromoted');
  });
});

describe('refusals arrive as themselves', () => {
  it('an unpromotable legacy snapshot answers 409 and names its prerequisite', async () => {
    promotePlanMix.mockRejectedValue(
      refuse(PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE, 'This plan predates the promotion contract.'),
    );

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(409);

    expect(res.body.error).toBe(PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE);
    expect(res.body.prerequisite).toBe('REBUILD_PLAN');
  });

  it('an open approval gate still answers ApprovalRequired', async () => {
    promotePlanMix.mockRejectedValue(
      Object.assign(refuse('ApprovalRequired', 'Plan requires STRATEGIST approval before execution'), { approvalState: 'PENDING' }),
    );

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(409);
    expect(res.body).toMatchObject({ error: 'ApprovalRequired', approvalState: 'PENDING' });
  });

  it('a plan with nothing to allocate answers NothingToPromote', async () => {
    promotePlanMix.mockRejectedValue(refuse(PROMOTION_REFUSAL.NOTHING_TO_PROMOTE, 'no channels to allocate'));

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(409);
    expect(res.body.error).toBe(PROMOTION_REFUSAL.NOTHING_TO_PROMOTE);
  });

  it('an unrecognised failure is still a 500 — no refusal is invented for it', async () => {
    promotePlanMix.mockRejectedValue(new Error('connection reset'));

    const res = await request(makeApp()).post('/plans/plan-1/promote').send({}).expect(500);
    expect(res.body.error).toBe('PromoteFailed');
  });
});
