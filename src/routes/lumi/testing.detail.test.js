// ============================================================
// C-13 · B — GET /api/lumi/tests/:id  (RED)
// ------------------------------------------------------------
// B7-03 carried one consequence into B9 in these words:
//
//     item-addressable truth — Signal → that decision, Guardrail → that
//     episode, Experiment → that experiment — resolvable without going
//     through `entityId`.
//
// Half of it shipped years ago and half of it never did. On `ea07e13`:
//
//     GET /incrementality/:id   exists  (measurement.js:147)
//     GET /tests/:id            does not exist at all
//
// The Testing OS has six routes: one GET, which is the LIST, and five POSTs
// that mutate a test by id. So a test is addressable for every purpose except
// being read. A client holding one experiment id must fetch up to 100
// experiments and filter — which is what "not addressable" means in practice.
//
// ── SHIPPED AHEAD OF ITS CONSUMER, DECLARED ─────────────────────────────────
//
// C-12 taught that a function written and never called is a defect waiting for
// its cure to be noticed. This read lands with no client caller, and that is a
// ruling rather than an oversight: B7-03 named the consumer in advance, and
// this file is its reader of record until B7 builds the destination. The
// difference between a contract and an orphan is whether somebody wrote that
// sentence down before shipping — nobody did for `GET /incrementality/:id`,
// which is why it has sat callerless since Phase 7C.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getTestById } = vi.hoisted(() => ({ getTestById: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    testExperiment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
// Every name testing.js imports must be present, or the module fails to load
// and the suite reports something other than what it is testing. C-12 lost a
// run to a mock that omitted one function of a two-function Promise.all.
vi.mock('../../services/test-tracker/TestTrackerService.js', () => ({
  startTest:            vi.fn(),
  recordVariantMetrics: vi.fn(),
  concludeTest:         vi.fn(),
  promoteTestToHoldout: vi.fn(),
  getTestById:          (...a) => getTestById(...a),
}));
vi.mock('../../services/test-generator/TestGeneratorService.js', () => ({
  getWeeklyAgenda: vi.fn().mockResolvedValue([]),
  commitAgenda:    vi.fn(),
}));
vi.mock('../../middleware/requirePlan.js', () => ({
  requirePlan: () => (req, res, next) =>
    (req.plan === 'PRO' ? next() : res.status(403).json({ error: 'PlanRequired' })),
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  requireCollabRole: () => (_req, _res, next) => next(),
}));
vi.mock('../../middleware/requireMeasurementTier.js', () => ({
  requireMeasurementTier: (_req, _res, next) => next(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { testingRouter } from './testing.js';

const WS = '00000000-0000-4000-8000-0000000c13a0';
const ID = '00000000-0000-4000-8000-0000000c13a1';

function makeApp({ plan = 'PRO' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = WS; req.userId = 'u1'; req.plan = plan; next(); });
  app.use('/', testingRouter);
  return app;
}

const aTest = () => ({
  id: ID, workspaceId: WS, dimension: 'CREATIVE', hypothesis: 'Static beats video',
  metric: 'CTR', status: 'RUNNING', entityId: null, decisionId: null,
  variants: [{ label: 'control', isControl: true, isWinner: false }],
});

beforeEach(() => { getTestById.mockReset(); });

describe('C-13 · B — one experiment is addressable by its own id', () => {
  it('T23 · 200 with the experiment, scoped to the caller’s workspace', async () => {
    getTestById.mockResolvedValue(aTest());
    const res = await request(makeApp()).get(`/tests/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.test.id).toBe(ID);
    expect(res.body.workspaceId).toBe(WS);
    expect(getTestById).toHaveBeenCalledWith(WS, ID);
  });

  it('T24 · the readout arms travel with it — the evidence is the variants', () => {
    // B7-04: an Experiment's evidence lives on its domain row, never on the
    // Decision. A by-id read that dropped `variants` would be addressable and
    // useless: the whole readout is the arms.
    getTestById.mockResolvedValue(aTest());
    return request(makeApp()).get(`/tests/${ID}`).then((res) => {
      expect(res.body.test.variants).toHaveLength(1);
    });
  });

  it('T25 · 404 when the id is not this workspace’s', async () => {
    // Not 403 and not an empty 200. The row may exist and belong to somebody
    // else; "not yours" and "not there" are answered identically on purpose,
    // because distinguishing them would confirm the row exists.
    getTestById.mockResolvedValue(null);
    const res = await request(makeApp()).get(`/tests/${ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('TestNotFound');
  });

  it('T26 · a failed read is a 500 that names itself, never an empty test', async () => {
    getTestById.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).get(`/tests/${ID}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('TestUnavailable');
    expect(res.body.test).toBeUndefined();
  });

  it('T27 · it sits behind the same PRO gate as the rest of the Testing OS', async () => {
    // The gate is `testingRouter.use('/tests', requirePlan('PRO'))`, which
    // covers '/tests' and everything beneath it. A by-id read that were more
    // permissive than the list it came from would be a way around the gate.
    getTestById.mockResolvedValue(aTest());
    const res = await request(makeApp({ plan: 'GROWTH' })).get(`/tests/${ID}`);
    expect(res.status).toBe(403);
    expect(getTestById).not.toHaveBeenCalled();
  });

  it('T28 · the list route still answers — :id did not shadow it', async () => {
    const res = await request(makeApp()).get('/tests');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('experiments');
  });
});
