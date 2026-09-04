// ============================================================
// PATCH /api/lumi/decisions/by-entity/:entityId/{explain,intent}
// ------------------------------------------------------------
// Two lifecycle signals, keyed by ENTITY because the verdict surfaces never
// receive a Decision id (getConnectorVerdicts recomputes in memory and returns
// id = entityId). These pin the three properties that make the signals worth
// recording at all: written once, scoped to the caller's workspace, and honest
// about the case where there is no live decision to record against.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findFirst: vi.fn(), update: vi.fn() } },
}));
const { getSimilarOutcomes } = vi.hoisted(() => ({ getSimilarOutcomes: vi.fn() }));
vi.mock('../../services/analysis/decisionLearning.js', () => ({ getSimilarOutcomes }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  requireCollabRole: (...allowed) => (req, res, next) =>
    (allowed.includes(req.collabRole) ? next() : res.status(403).json({ error: 'Forbidden' })),
}));

import { prisma } from '../../lib/prisma.js';
import { decisionsRouter } from './decisions.js';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { scopeFor } from '../../services/decisions/decisionClassScope.js';

const WS = 'ws-1';
const ENTITY = 'e1e1e1e1-0000-4000-8000-000000000001';
const D_ID = 'd-1';

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  // Flat-mounted at '/', exactly as lumi/index.js does it.
  app.use('/api/lumi', decisionsRouter);
  return app;
}

const patch = (signal, opts) =>
  request(makeApp(opts)).patch(`/api/lumi/decisions/by-entity/${ENTITY}/${signal}`).send({});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue({ id: D_ID, explainedAt: null, intentAt: null });
  prisma.decision.update.mockResolvedValue({ id: D_ID });
});

describe.each([
  ['explain', 'explainedAt'],
  ['intent', 'intentAt'],
])('PATCH …/%s', (signal, field) => {
  it(`stamps ${field} on the live verdict`, async () => {
    const res = await patch(signal);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, recorded: true });
    const call = prisma.decision.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: D_ID });
    expect(call.data[field]).toBeInstanceOf(Date);
  });

  // A second click is not a second engagement. Re-stamping would turn "when did
  // someone FIRST look at this" into "when did they last click".
  it('never overwrites an existing timestamp', async () => {
    const first = new Date('2026-07-01T10:00:00Z');
    prisma.decision.findFirst.mockResolvedValue({ id: D_ID, [field]: first });

    const res = await patch(signal);
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    expect(new Date(res.body[field]).toISOString()).toBe(first.toISOString());
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  // C-01 — the scope is new, and it is the whole point of the assertion.
  // `by-entity` is only ever a correct address for a class with at most one open
  // row per entity, and supersession makes Signal that class. Unscoped,
  // `createdAt desc` meant "whichever class wrote last", which under a standing
  // breach is always the guardrail sweep — so reading a Signal's reasoning
  // stamped `explainedAt` onto a Guardrail episode.
  //
  // Asserted on the QUERY rather than by seeding a guardrail row: prisma is
  // mocked and hands back whatever it is given regardless of the filter, so a
  // seeded row would prove the route's behaviour and nothing about the boundary.
  // Spread from the exported scope, never a restated list of causes.
  it('reads only the live PROPOSED SIGNAL for this entity, newest first', async () => {
    await patch(signal);
    expect(prisma.decision.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where:   { workspaceId: WS, entityId: ENTITY, status: 'PROPOSED', ...scopeFor('decisions/stamp-by-entity') },
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('cannot reach a guardrail episode on the same entity', async () => {
    await patch(signal);
    const { where } = prisma.decision.findFirst.mock.calls[0][0];
    // C-10 — the same boundary, now asked of the CLASS. A prefix that a rename
    // could move out from under this is no longer what keeps a foreign row out.
    const admits = (cls) => where.decisionClass.in.includes(cls);
    expect(admits(DECISION_CLASS.GUARDRAIL)).toBe(false);
    expect(admits(DECISION_CLASS.ALLOCATION)).toBe(false);
    expect(admits(DECISION_CLASS.EXPERIMENT)).toBe(false);
    expect(admits(DECISION_CLASS.SIGNAL)).toBe(true);
  });

  // Silence would make a missing signal indistinguishable from a recorded one
  // when the learning query later comes up empty.
  it('404s when the entity has no live decision', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    const res = await patch(signal);
    expect(res.status).toBe(404);
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('400s with no workspace rather than writing cross-tenant', async () => {
    const res = await patch(signal, { workspaceId: null });
    expect(res.status).toBe(400);
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  it('500s honestly when the read fails', async () => {
    prisma.decision.findFirst.mockRejectedValue(new Error('db down'));
    const res = await patch(signal);
    expect(res.status).toBe(500);
  });

  // A CLIENT seat is read-only and must not seed the learning loop.
  it('403s a CLIENT', async () => {
    const res = await patch(signal, { collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  it.each([['BUYER'], ['STRATEGIST']])('allows %s', async (role) => {
    const res = await patch(signal, { collabRole: role });
    expect(res.status).toBe(200);
  });
});

describe('the two signals are independent', () => {
  it('explain does not stamp intentAt', async () => {
    await patch('explain');
    expect(prisma.decision.update.mock.calls[0][0].data).not.toHaveProperty('intentAt');
  });

  it('intent does not stamp explainedAt', async () => {
    await patch('intent');
    expect(prisma.decision.update.mock.calls[0][0].data).not.toHaveProperty('explainedAt');
  });

  // Acting on a decision without expanding it first is normal — the verdict and
  // rationale are already on the row.
  it('intent can be recorded with no prior explain', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: D_ID, intentAt: null });
    const res = await patch('intent');
    expect(res.body.recorded).toBe(true);
  });
});

// The track record behind a live verdict. `learning: null` is the NORMAL
// answer — a young workspace has no track record for almost anything — so it
// must never read as a failure.
describe('GET …/learning', () => {
  const TALLY = { total: 12, improved: 9, unchanged: 2, worsened: 1, unscored: 0, confidence: 0.75 };
  const LIVE = { verdict: 'KILL', rootCause: 'LOW_CTR', entityLevel: 'CAMPAIGN', objective: 'OUTCOME_SALES', channel: 'META' };
  const get = (opts) => request(makeApp(opts)).get(`/api/lumi/decisions/by-entity/${ENTITY}/learning`);

  beforeEach(() => {
    prisma.decision.findFirst.mockResolvedValue(LIVE);
    getSimilarOutcomes.mockResolvedValue(TALLY);
  });

  it('returns the tally for the live verdict', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.learning).toMatchObject({ total: 12, improved: 9 });
  });

  // The client must not be able to name its own similarity key — it could then
  // ask for the flattering comparison instead of the true one.
  it('derives the similarity key from the stored decision, not the request', async () => {
    await get();
    expect(getSimilarOutcomes).toHaveBeenCalledWith({ workspaceId: WS, ...LIVE });
  });

  it.each([
    ['no live decision', () => prisma.decision.findFirst.mockResolvedValue(null)],
    ['too small a sample', () => getSimilarOutcomes.mockResolvedValue(null)],
  ])('%s → 200 with learning: null, never an error', async (_label, arrange) => {
    arrange();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ learning: null });
  });

  // This is decoration on a decision the user is already reading. Failing the
  // panel over a missing track record would cost more than the line is worth.
  it('a failed read degrades to learning: null, still 200', async () => {
    prisma.decision.findFirst.mockRejectedValue(new Error('db down'));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ learning: null });
  });

  it('no workspace → learning: null, without querying', async () => {
    const res = await get({ workspaceId: null });
    expect(res.body).toEqual({ learning: null });
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  it('403s a CLIENT', async () => {
    const res = await get({ collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
  });

  it.each([['BUYER'], ['STRATEGIST']])('allows %s', async (role) => {
    expect((await get({ collabRole: role })).status).toBe(200);
  });
});

// The router is flat-mounted at '/' beside its siblings. A path-less
// router.use(gate) here would 403 every route mounted after it — the bug that
// took out half the app in PR #226.
describe('mount safety', () => {
  it('does not gate sibling paths', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.workspaceId = WS; req.collabRole = 'CLIENT'; next(); });
    app.use('/api/lumi', decisionsRouter);
    app.get('/api/lumi/connections', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/api/lumi/connections');
    expect(res.status).toBe(200); // a CLIENT still reaches a sibling route
  });
});
