// ============================================================
// Lumi mutation routes — STRATEGIST-only gate (security)
// ------------------------------------------------------------
// Planning / portfolio / measurement / memory / account-config mutations
// belong to the STRATEGIST (these surfaces are not in a BUYER's or CLIENT's
// visibleStates). BOTH a CLIENT and a BUYER must be 403'd. Measurement also
// sits behind a workspace-tier gate; MEASUREMENT_TIER_OVERRIDE lifts that so
// the test exercises the ROLE gate specifically (asserts RoleForbidden).
// ============================================================
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => {
  const model = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
  return { prisma: new Proxy({}, { get: () => model }) };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { portfolioRouter }   from './portfolio.js';
import { planningRouter }    from './planning.js';
import { measurementRouter } from './measurement.js';
import { memoryRouter }      from './memory.js';
import { connectionsRouter } from './connections.js';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.user = { uid: 'firebase-user-1' };
    req.workspaceId = 'ws1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', portfolioRouter);
  app.use('/', planningRouter);
  app.use('/', measurementRouter);
  app.use('/', memoryRouter);
  app.use('/', connectionsRouter);
  return app;
}

const ROUTES = [
  { method: 'post',  path: '/portfolio/allocate/commit',      body: { totalBudgetMinor: 100000 } },
  { method: 'put',   path: '/economics',                       body: {} },
  { method: 'post',  path: '/goals',                           body: {} },
  { method: 'post',  path: '/plans',                           body: {} },
  { method: 'post',  path: '/plans/p1/promote',                body: {} },
  { method: 'post',  path: '/incrementality',                  body: {} },
  { method: 'post',  path: '/incrementality/t1/metrics',       body: {} },
  { method: 'post',  path: '/incrementality/t1/conclude',      body: {} },
  { method: 'post',  path: '/patterns/p1/promote',             body: {} },
  { method: 'patch', path: '/connections/account',            body: { platform: 'META', accountId: '1' } },
];

describe('Lumi STRATEGIST-only mutation routes — collab-role gate', () => {
  // Lift the workspace-level gates (measurement tier + plan paywall) so the
  // ROLE gate is specifically what these tests exercise. PLAN_OVERRIDE=PRO
  // clears requirePlan on economics/goals/plans (GROWTH) + incrementality (PRO).
  beforeAll(() => { process.env.MEASUREMENT_TIER_OVERRIDE = 'AGENCY'; process.env.PLAN_OVERRIDE = 'PRO'; });
  afterAll(() => { delete process.env.MEASUREMENT_TIER_OVERRIDE; delete process.env.PLAN_OVERRIDE; });
  beforeEach(() => vi.clearAllMocks());

  for (const r of ROUTES) {
    it(`403s a CLIENT on ${r.method.toUpperCase()} ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'CLIENT' }))[r.method](r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden');
    });

    it(`403s a BUYER on ${r.method.toUpperCase()} ${r.path} (strategist surface)`, async () => {
      const res = await request(makeApp({ collabRole: 'BUYER' }))[r.method](r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden');
    });
  }

  it('lets a STRATEGIST past the gate on POST /goals', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/goals').send({});
    expect(res.status).not.toBe(403);
  });
});
