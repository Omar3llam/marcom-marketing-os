import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { northStarGoal: { create: vi.fn() } } }));
vi.mock('../../services/planning/PlanService.js', () => ({
  buildPlan: vi.fn(), listPlans: vi.fn(), getPlan: vi.fn(), promotePlanMix: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prisma.js';
import { buildPlan } from '../../services/planning/PlanService.js';
import { planningRouter } from './planning.js';

const planBody = (currency) => ({
  totalBudgetMinor: 100000, totalBudgetCurrency: currency,
  periodStart: '2026-09-01', periodEnd: '2026-09-30',
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.workspaceId = 'ws-1';
  req.collabRole = 'STRATEGIST';
  next();
});
app.use('/', planningRouter);

describe('planning HTTP monetary contract', () => {
  beforeAll(() => { process.env.PLAN_OVERRIDE = 'PRO'; });
  afterAll(() => { delete process.env.PLAN_OVERRIDE; });
  beforeEach(() => vi.clearAllMocks());

  it.each(['EGP', 'USD', 'SAR'])('forwards the explicit %s budget denomination', async (currency) => {
    buildPlan.mockResolvedValue({ id: 'plan-1', currency });
    const response = await request(app).post('/plans').send(planBody(currency)).expect(201);
    expect(response.body.plan.currency).toBe(currency);
    expect(buildPlan).toHaveBeenCalledWith('ws-1', expect.objectContaining({ totalBudgetCurrency: currency }));
  });

  it('returns the original monetary refusal status and reason', async () => {
    buildPlan.mockRejectedValue(Object.assign(new Error('No proven denomination'), {
      code: 'PlanMonetaryUnavailable', monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED',
      reason: 'BUDGET_CURRENCY_MISSING',
    }));
    const response = await request(app).post('/plans').send(planBody(undefined)).expect(409);
    expect(response.body).toMatchObject({
      error: 'PlanMonetaryUnavailable', monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED',
      reason: 'BUDGET_CURRENCY_MISSING',
    });
    expect(buildPlan).toHaveBeenCalledWith('ws-1', expect.objectContaining({ totalBudgetCurrency: undefined }));
  });

  it('requires an explicit supported currency for standalone Goal creation', async () => {
    const body = { metric: 'mer', comparator: 'GTE', targetValue: 2, periodStart: '2026-09-01', periodEnd: '2026-09-30' };
    await request(app).post('/goals').send(body).expect(400);
    await request(app).post('/goals').send({ ...body, currency: 'XYZ' }).expect(400);
    expect(prisma.northStarGoal.create).not.toHaveBeenCalled();
    prisma.northStarGoal.create.mockResolvedValue({ id: 'goal-1', currency: 'EGP' });
    await request(app).post('/goals').send({ ...body, currency: 'egp' }).expect(201);
    expect(prisma.northStarGoal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: 'EGP' }),
    }));
  });
});
