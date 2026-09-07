// ============================================================
// B8-05 — GET /api/lumi/incrementality/:id gets a reader of record
// ------------------------------------------------------------
// This route has existed since Phase 7C. Its own comment says why:
//
//     // GET so the tier-gate middleware also has a route to attach to.
//
// It was created for a middleware, not for a reader. Measured on `d60c12f`:
// zero client callers, and zero tests of ANY kind performing a GET on it —
// the two mentions in the suite are the POST role-gate rows. `testing.js`
// noticed this in writing when its own by-id read shipped:
//
//     Nobody wrote that sentence for `GET /incrementality/:id`, which is why
//     it has sat callerless since Phase 7C.
//
// B8-05 is the slice that reaches it, so this is where that sentence gets
// written. The route's behaviour is pinned here FIRST — including the two
// gates, which are separate axes and must both hold on a by-id read exactly as
// they hold on the list it opens from.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getTest } = vi.hoisted(() => ({ getTest: vi.fn() }));

vi.mock('../../services/incrementality-engine/IncrementalityService.js', () => ({
  designTest:             vi.fn(),
  listTests:              vi.fn().mockResolvedValue([]),
  recordCounts:           vi.fn(),
  concludeIncrementality: vi.fn(),
  getTest:                (...a) => getTest(...a),
}));
vi.mock('../../services/attribution-engine/AttributionService.js', () => ({
  getAttribution: vi.fn(),
}));
vi.mock('../../services/reconciliation/ReconciliationService.js', () => ({
  getReconciliation: vi.fn(),
}));
// Both gates are mocked as SWITCHES, not as pass-throughs: the point of T36/T37
// is that each one independently refuses, so each needs to be able to refuse.
vi.mock('../../middleware/requirePlan.js', () => ({
  requirePlan: () => (req, res, next) =>
    (req.plan === 'PRO' ? next() : res.status(403).json({ error: 'PLAN_REQUIRED' })),
}));
vi.mock('../../middleware/requireMeasurementTier.js', () => ({
  requireMeasurementTier: (req, res, next) => {
    if (req.tier === 'NONE') return res.status(403).json({ error: 'MeasurementGated', tier: 'NONE' });
    req.measurementWorkspaceId = req.workspaceId;
    return next();
  },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  requireCollabRole: () => (_req, _res, next) => next(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { measurementRouter } from './measurement.js';

const WS = '00000000-0000-4000-8000-0000000b8052';
const ID = '00000000-0000-4000-8000-0000000b8053';
const SRC = '00000000-0000-4000-8000-0000000b8054';

function makeApp({ plan = 'PRO', tier = 'AGENCY' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = WS; req.userId = 'u1'; req.plan = plan; req.tier = tier; next(); });
  app.use('/', measurementRouter);
  return app;
}

const aHoldout = (over = {}) => ({
  id: ID, workspaceId: WS, name: 'Meta holdout', channel: 'META',
  holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 1000, durationDays: 14,
  status: 'DESIGNED', exposedUsers: 0, exposedConversions: 0,
  holdoutUsers: 0, holdoutConversions: 0, decisionId: null, sourceTest: null,
  ...over,
});

beforeEach(() => { getTest.mockReset(); });

describe('B8-05 — one holdout is addressable by its own id', () => {
  it('T32 · 200 with the holdout, scoped to the caller’s workspace', async () => {
    getTest.mockResolvedValue(aHoldout());
    const res = await request(makeApp()).get(`/incrementality/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.test.id).toBe(ID);
    expect(getTest).toHaveBeenCalledWith(WS, ID);
  });

  it('T33 · provenance travels — a promoted holdout says so by id, as it does in the list', async () => {
    getTest.mockResolvedValue(aHoldout({
      sourceTest: { id: SRC, dimension: 'HOOK', hypothesis: 'Static beats video' },
    }));
    const res = await request(makeApp()).get(`/incrementality/${ID}`);
    expect(res.body.test.sourceTest).toMatchObject({ id: SRC, dimension: 'HOOK' });
  });

  it('T34 · 404 when the id is not this workspace’s', async () => {
    getTest.mockResolvedValue(null);
    const res = await request(makeApp()).get(`/incrementality/${ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('HoldoutNotFound');
  });

  it('T35 · a failed read is a 500 that names itself, never an empty holdout', async () => {
    getTest.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).get(`/incrementality/${ID}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('IncrementalityUnavailable');
    expect(res.body.test).toBeUndefined();
  });

  // ── The two gates are independent axes (measurement.js:28-33) ──
  it('T36 · the PRO plan gate holds on the by-id read', async () => {
    getTest.mockResolvedValue(aHoldout());
    const res = await request(makeApp({ plan: 'GROWTH' })).get(`/incrementality/${ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('PLAN_REQUIRED');
    expect(getTest).not.toHaveBeenCalled();
  });

  it('T37 · the measurement-tier gate holds too, and answers differently', async () => {
    // A PRO workspace with tier NONE still 403s. Two refusals, two fixes:
    // "upgrade the plan" and "measurement is not enabled here" are not the same
    // sentence, and C-07 is the contract that says a token cannot replace a
    // reason. The client reads `error` to know which to say.
    getTest.mockResolvedValue(aHoldout());
    const res = await request(makeApp({ plan: 'PRO', tier: 'NONE' })).get(`/incrementality/${ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('MeasurementGated');
    expect(getTest).not.toHaveBeenCalled();
  });

  it('T38 · the list route still answers — :id did not shadow it', async () => {
    const res = await request(makeApp()).get('/incrementality');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tests');
  });
});
