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
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  requireCollabRole: (...allowed) => (req, res, next) =>
    (allowed.includes(req.collabRole) ? next() : res.status(403).json({ error: 'Forbidden' })),
}));

import { prisma } from '../../lib/prisma.js';
import { decisionsRouter } from './decisions.js';

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

  it('reads only the live PROPOSED verdict, newest first', async () => {
    await patch(signal);
    expect(prisma.decision.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where:   { workspaceId: WS, entityId: ENTITY, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' },
    }));
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
