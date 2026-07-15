// ============================================================
// requirePlan — feature-gating entitlement gate (unit + route wiring)
// ------------------------------------------------------------
// Unit: the FREE < GROWTH < PRO hierarchy, the 403 PLAN_REQUIRED shape, the
// FREE-default for a missing plan, PLAN_OVERRIDE, no-workspace 409, DB-error 500.
// Wiring: the real portfolio + testing routers 403 the gated paths on FREE and
// — critically — GET /portfolio stays FREE (it feeds the Overview pacing widget).
// ============================================================
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable plan the mocked workspace.findUnique returns (null ⇒ row missing).
const h = vi.hoisted(() => ({ plan: 'FREE', throw: false }));

vi.mock('../lib/prisma.js', () => {
  const anyModel = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
  return {
    prisma: new Proxy(
      {
        workspace: {
          findUnique: vi.fn(async () => {
            if (h.throw) throw new Error('db down');
            return h.plan === null ? null : { plan: h.plan };
          }),
        },
      },
      { get: (t, p) => (p in t ? t[p] : anyModel) },
    ),
  };
});
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requirePlan } from './requirePlan.js';
import { portfolioRouter } from '../routes/lumi/portfolio.js';
import { testingRouter } from '../routes/lumi/testing.js';

// Tiny app: one gated route that echoes the resolved plan when it passes.
function unitApp(minPlan, { workspaceId = 'ws1', userId = 'u1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = userId; req.workspaceId = workspaceId; next(); });
  app.get('/x', requirePlan(minPlan), (req, res) => res.json({ ok: true, plan: req.workspacePlan }));
  return app;
}

function routerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'u1'; req.workspaceId = 'ws1'; next(); });
  app.use('/', portfolioRouter);
  app.use('/', testingRouter);
  return app;
}

beforeEach(() => { h.plan = 'FREE'; h.throw = false; delete process.env.PLAN_OVERRIDE; vi.clearAllMocks(); });
afterEach(() => { delete process.env.PLAN_OVERRIDE; });

describe('requirePlan — hierarchy', () => {
  it('FREE workspace is 403d on a GROWTH route with the PLAN_REQUIRED shape', async () => {
    h.plan = 'FREE';
    const res = await request(unitApp('GROWTH')).get('/x').expect(403);
    expect(res.body).toEqual({
      error: 'PLAN_REQUIRED', required: 'GROWTH', current: 'FREE',
      message: 'This feature requires the GROWTH plan.',
    });
  });

  it('GROWTH workspace passes a GROWTH route (and exposes req.workspacePlan)', async () => {
    h.plan = 'GROWTH';
    const res = await request(unitApp('GROWTH')).get('/x').expect(200);
    expect(res.body).toEqual({ ok: true, plan: 'GROWTH' });
  });

  it('PRO workspace passes a GROWTH route (higher tier includes lower)', async () => {
    h.plan = 'PRO';
    await request(unitApp('GROWTH')).get('/x').expect(200);
  });

  it('GROWTH workspace is 403d on a PRO route', async () => {
    h.plan = 'GROWTH';
    const res = await request(unitApp('PRO')).get('/x').expect(403);
    expect(res.body.required).toBe('PRO');
    expect(res.body.current).toBe('GROWTH');
  });

  it('a FREE route is open to a FREE workspace', async () => {
    h.plan = 'FREE';
    await request(unitApp('FREE')).get('/x').expect(200);
  });
});

describe('requirePlan — safe defaults + edges', () => {
  it('a missing plan column defaults to FREE (never fabricated as unlocked)', async () => {
    h.plan = null; // workspace row exists but plan is null → FREE
    const res = await request(unitApp('GROWTH')).get('/x').expect(403);
    expect(res.body.current).toBe('FREE');
  });

  it('an unresolvable workspace is a 409, not a silent pass', async () => {
    const res = await request(unitApp('GROWTH', { workspaceId: null, userId: null })).get('/x').expect(409);
    expect(res.body.error).toBe('NoWorkspace');
  });

  it('a plan-lookup DB error fails closed with a 500 (not an open free pass)', async () => {
    h.throw = true;
    await request(unitApp('GROWTH')).get('/x').expect(500);
  });

  it('PLAN_OVERRIDE lifts the gate without a DB read', async () => {
    process.env.PLAN_OVERRIDE = 'PRO';
    h.plan = 'FREE'; // would 403 without the override
    await request(unitApp('GROWTH')).get('/x').expect(200);
  });

  it('PLAN_OVERRIDE still HONORS the gate when set below the requirement', async () => {
    process.env.PLAN_OVERRIDE = 'FREE';
    const res = await request(unitApp('PRO')).get('/x').expect(403);
    expect(res.body.current).toBe('FREE');
  });
});

describe('requirePlan — route wiring', () => {
  it('FREE is 403d on GET /blended (GROWTH)', async () => {
    h.plan = 'FREE';
    const res = await request(routerApp()).get('/blended').expect(403);
    expect(res.body).toMatchObject({ error: 'PLAN_REQUIRED', required: 'GROWTH' });
  });

  it('FREE is 403d on GET /tests (PRO)', async () => {
    h.plan = 'FREE';
    const res = await request(routerApp()).get('/tests').expect(403);
    expect(res.body).toMatchObject({ error: 'PLAN_REQUIRED', required: 'PRO' });
  });

  it('REGRESSION: GET /portfolio stays FREE — the Overview pacing read is never plan-gated', async () => {
    h.plan = 'FREE';
    const res = await request(routerApp()).get('/portfolio');
    expect(res.status).not.toBe(403); // may 200/500 from the handler, but NEVER a plan 403
  });

  it('PRO gets past the plan gate on GET /tests', async () => {
    h.plan = 'PRO';
    const res = await request(routerApp()).get('/tests');
    expect(res.status).not.toBe(403);
  });
});
