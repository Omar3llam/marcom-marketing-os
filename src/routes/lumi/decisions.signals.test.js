// ============================================================
// PATCH /api/lumi/decisions/:id/{execute,dismiss} — the two human signals
// ------------------------------------------------------------
// The engine has issued verdicts since day one and the product has never been
// able to record that a human acted on one. These are that record.
//
// Three properties carry the whole value, and each is a way the signal could be
// quietly worthless instead:
//
//   MUTUALLY EXCLUSIVE — executing and dismissing the same call are contradictory
//     claims. A row carrying both reports itself as acted-on AND rejected, and
//     every downstream count would include it twice.
//   IDEMPOTENT — a second click is not a second execution. Re-stamping would turn
//     "when did they act" into "when did they last click", which is the mistake
//     the two lifecycle stamps above this file already exist to avoid.
//   NOT A STATUS MOVE — four readers gate on status = 'PROPOSED'. These routes
//     leave it alone, so recording a signal must not evict the decision from the
//     feed, the agenda, or the two by-entity stamps.
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

const WS = 'ws-1';
const D_ID = 'd-1';
const ENTITY = 'e1e1e1e1-0000-4000-8000-000000000001';

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  // Flat-mounted at '/api/lumi', exactly as lumi/index.js does it — which is why
  // every path in this router carries its own '/decisions' prefix.
  app.use('/api/lumi', decisionsRouter);
  return app;
}

const send = (signal, opts) =>
  request(makeApp(opts)).patch(`/api/lumi/decisions/${D_ID}/${signal}`).send({});

const live = (over = {}) => ({ id: D_ID, status: 'PROPOSED', executedAt: null, dismissedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue(live());
  prisma.decision.update.mockResolvedValue({ id: D_ID });
});

describe('recording a signal', () => {
  it.each([['execute', 'executedAt'], ['dismiss', 'dismissedAt']])(
    '%s stamps %s on a live decision', async (signal, field) => {
      const res = await send(signal).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.recorded).toBe(true);
      expect(res.body[field]).toEqual(expect.any(String));
      expect(prisma.decision.update).toHaveBeenCalledWith({
        where: { id: D_ID },
        data: { [field]: expect.any(Date) },
      });
    });

  it('scopes the lookup to the caller workspace', async () => {
    await send('execute');
    expect(prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: D_ID, workspaceId: WS } }),
    );
  });

  it('does NOT touch status — the decision stays live for the feed and the agenda', async () => {
    await send('execute');
    const { data } = prisma.decision.update.mock.calls[0][0];
    expect(data).toEqual({ executedAt: expect.any(Date) });
    expect(data.status).toBeUndefined();
  });

  it('does not filter the lookup by status — a moved decision must be reportable', async () => {
    await send('execute');
    expect(prisma.decision.findFirst.mock.calls[0][0].where.status).toBeUndefined();
  });

  it('400s without a workspace rather than writing against none', async () => {
    const res = await send('execute', { workspaceId: null }).expect(400);
    expect(res.body.error).toBe('NoWorkspace');
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('404s a decision in another workspace — never a cheerful ok:true', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    const res = await send('execute').expect(404);
    expect(res.body.error).toBe('DecisionNotFound');
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });
});

describe('idempotency — a second click is not a second execution', () => {
  it.each([['execute', 'executedAt'], ['dismiss', 'dismissedAt']])(
    '%s returns the ORIGINAL %s and writes nothing', async (signal, field) => {
      const first = new Date('2026-08-01T10:00:00.000Z');
      prisma.decision.findFirst.mockResolvedValue(live({ [field]: first }));

      const res = await send(signal).expect(200);
      expect(res.body.recorded).toBe(false);
      expect(res.body[field]).toBe(first.toISOString());
      expect(prisma.decision.update).not.toHaveBeenCalled();
    });

  // The order of the two gates matters. A decision executed while live and
  // superseded by the next sweep must still report its own signal: the claim was
  // true when it was made, and 409ing on it would make an honest record look
  // like a rejected write.
  it('reports an existing signal even after the decision was superseded', async () => {
    const first = new Date('2026-08-01T10:00:00.000Z');
    prisma.decision.findFirst.mockResolvedValue(live({ status: 'SUPERSEDED', executedAt: first }));
    const res = await send('execute').expect(200);
    expect(res.body.recorded).toBe(false);
    expect(res.body.executedAt).toBe(first.toISOString());
  });
});

describe('mutual exclusion — the two claims contradict each other', () => {
  it('409s dismiss on an already-executed decision', async () => {
    const at = new Date('2026-08-01T10:00:00.000Z');
    prisma.decision.findFirst.mockResolvedValue(live({ executedAt: at }));
    const res = await send('dismiss').expect(409);
    expect(res.body.error).toBe('AlreadyExecuted');
    expect(res.body.executedAt).toBe(at.toISOString());
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('409s execute on an already-dismissed decision', async () => {
    const at = new Date('2026-08-01T10:00:00.000Z');
    prisma.decision.findFirst.mockResolvedValue(live({ dismissedAt: at }));
    const res = await send('execute').expect(409);
    expect(res.body.error).toBe('AlreadyDismissed');
    expect(res.body.dismissedAt).toBe(at.toISOString());
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('names WHICH signal already landed, so the caller can render it', async () => {
    prisma.decision.findFirst.mockResolvedValue(live({ dismissedAt: new Date() }));
    const res = await send('execute').expect(409);
    // Not a bare "conflict": the UI has to be able to say what happened before.
    expect(res.body.message).toMatch(/dismissed/);
  });
});

describe('only a live call can be acted on', () => {
  it.each([['execute'], ['dismiss']])('%s 409s a SUPERSEDED decision with no prior signal', async (signal) => {
    prisma.decision.findFirst.mockResolvedValue(live({ status: 'SUPERSEDED' }));
    const res = await send(signal).expect(409);
    expect(res.body.error).toBe('DecisionNotActionable');
    expect(res.body.status).toBe('SUPERSEDED');
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  // 409, not 404. The decision exists and the caller can see it; saying "not
  // found" would send them looking for a row that is right there, and would make
  // a superseded call indistinguishable from someone else's workspace.
  it('distinguishes "moved on" (409) from "not yours" (404)', async () => {
    prisma.decision.findFirst.mockResolvedValue(live({ status: 'SUPERSEDED' }));
    await send('execute').expect(409);

    prisma.decision.findFirst.mockResolvedValue(null);
    await send('execute').expect(404);
  });
});

describe('role gate — a CLIENT seat must not seed the learning loop', () => {
  it.each([['execute'], ['dismiss']])('%s 403s a CLIENT', async (signal) => {
    await send(signal, { collabRole: 'CLIENT' }).expect(403);
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  it.each([['BUYER'], ['STRATEGIST']])('%s may record both signals', async (collabRole) => {
    await send('execute', { collabRole }).expect(200);
    await send('dismiss', { collabRole }).expect(200);
  });
});

describe('route shape', () => {
  // '/decisions/:id/execute' is three segments; '/decisions/by-entity/:entityId/
  // explain' is four. They cannot capture each other — but only a test keeps that
  // true as routes are added to a FLAT-MOUNTED router.
  it('does not swallow the by-entity stamps', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: D_ID, explainedAt: null });
    const res = await request(makeApp())
      .patch(`/api/lumi/decisions/by-entity/${ENTITY}/explain`).send({}).expect(200);
    expect(res.body.explainedAt).toEqual(expect.any(String));
    // The by-entity handler queries by entityId + PROPOSED; the signal handler
    // queries by id. Hitting the wrong one would show up here.
    expect(prisma.decision.findFirst.mock.calls[0][0].where).toMatchObject({ entityId: ENTITY, status: 'PROPOSED' });
  });

  it('500s without leaking the error message', async () => {
    prisma.decision.findFirst.mockRejectedValue(new Error('connection terminated'));
    const res = await send('execute').expect(500);
    expect(res.body).toEqual({ error: 'DecisionUnavailable', message: 'Request failed' });
  });
});
