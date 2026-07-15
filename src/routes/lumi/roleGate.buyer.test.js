// ============================================================
// Lumi mutation routes — BUYER/STRATEGIST gate (security)
// ------------------------------------------------------------
// Execution-, testing- and operations-tier mutations: a CLIENT seat
// (read-only leadership, REPORT-only) must be 403'd at the gate. BUYER
// and STRATEGIST pass. The REAL requireCollabRole runs; prisma/logger
// are mocked so a blocked request never touches a service or the DB.
// ============================================================
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Proxy prisma: any prisma.<model>.<method>() resolves to undefined, so the
// allowed-role smoke lands in a handler that fails closed (4xx/5xx), never 403.
vi.mock('../../lib/prisma.js', () => {
  const model = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
  return { prisma: new Proxy({}, { get: () => model }) };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { testingRouter }       from './testing.js';
import { agenticRouter }       from './agentic.js';
import { connectionsRouter }   from './connections.js';
import { collaborationRouter } from './collaboration.js';
import { intelligenceRouter }  from './intelligence.js';

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
  app.use('/', testingRouter);
  app.use('/', agenticRouter);
  app.use('/', connectionsRouter);
  app.use('/', collaborationRouter);
  app.use('/', intelligenceRouter);
  return app;
}

const ROUTES = [
  { method: 'post', path: '/tests',            body: { picks: [{ id: 'x' }] } },
  { method: 'post', path: '/tests/t1/start',   body: {} },
  { method: 'post', path: '/tests/t1/metrics', body: { variants: [{ id: 'v' }] } },
  { method: 'post', path: '/tests/t1/conclude', body: {} },
  { method: 'post', path: '/loop/run',         body: {} },
  { method: 'post', path: '/connections/sync', body: {} },
  { method: 'post', path: '/approvals',        body: { planId: 'p1' } },
  { method: 'post', path: '/orchestrate/c1',   body: {} },
];

describe('Lumi BUYER/STRATEGIST mutation routes — collab-role gate', () => {
  // Lift the plan paywall so the ROLE gate is what we test: /tests* (PRO) and
  // /approvals (GROWTH) now sit behind requirePlan, which would otherwise 403
  // first (mocked prisma ⇒ plan defaults to FREE).
  beforeAll(() => { process.env.PLAN_OVERRIDE = 'PRO'; });
  afterAll(() => { delete process.env.PLAN_OVERRIDE; });
  beforeEach(() => vi.clearAllMocks());

  for (const r of ROUTES) {
    it(`403s a CLIENT on ${r.method.toUpperCase()} ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'CLIENT' }))[r.method](r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden'); // the ROLE gate, not a downstream 403
    });
  }

  // No over-block: an allowed role gets past the gate (some non-403 outcome).
  it('lets a BUYER past the gate on POST /tests', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).post('/tests').send({ picks: [{ id: 'x' }] });
    expect(res.status).not.toBe(403);
  });
  it('lets a STRATEGIST past the gate on POST /orchestrate/c1', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/orchestrate/c1').send({});
    expect(res.status).not.toBe(403);
  });
});
