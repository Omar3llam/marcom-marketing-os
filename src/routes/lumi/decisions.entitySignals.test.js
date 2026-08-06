// ============================================================
// PATCH /api/lumi/decisions/by-entity/:entityId/{execute,dismiss}
// ------------------------------------------------------------
// The by-id routes are the ones that mean what they say. These exist because no
// verdict surface has a Decision id to send: getConnectorVerdicts recomputes
// verdicts in memory and returns `id = entityId`, so the id the by-id routes
// want is not merely un-projected — it is absent from the read path entirely.
//
// What is tested here is therefore mostly what must NOT drift:
//   RESOLUTION — the live PROPOSED row, newest first, the same one explain and
//     intent resolve to. All four signals must agree on what "this entity's
//     decision" is, or the learning query joins rows that never met.
//   WORKSPACE SCOPE — an unresolved workspace must 400, never fall through. A
//     missing predicate in this WHERE does not narrow the query, it widens it
//     across every account in the table.
//   THE SHARED TAIL — idempotency and mutual exclusion are the rules that decide
//     what the accuracy surface counts. Both keyings run the same code, and
//     these assert the by-entity path really does inherit it.
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
const ENTITY = 'e1e1e1e1-0000-4000-8000-000000000001';
const AT = new Date('2026-08-01T10:00:00.000Z');

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  // Flat-mounted at '/api/lumi', exactly as lumi/index.js does it.
  app.use('/api/lumi', decisionsRouter);
  return app;
}

const send = (signal, opts) =>
  request(makeApp(opts))
    .patch(`/api/lumi/decisions/by-entity/${ENTITY}/${signal}`)
    .send({});

const live = (over = {}) => ({ id: 'd-1', executedAt: null, dismissedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.update.mockResolvedValue({});
});

describe('resolution — which decision a click lands on', () => {
  it('the newest LIVE verdict for the entity, in this workspace', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    await send('execute').expect(200);

    expect(prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { workspaceId: WS, entityId: ENTITY, status: 'PROPOSED' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  // The lookup filters on PROPOSED, so a superseded row is simply not found.
  // 404 rather than a cheerful 200: a signal we could not record must never be
  // indistinguishable from one we did — that is the failure the whole Proof
  // Engine spent three PRs climbing out of.
  it('404s when the verdict has already been replaced', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    const res = await send('execute').expect(404);
    expect(res.body.error).toBe('NoLiveDecision');
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('selects both timestamps — the tail reads them to decide what to do', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    await send('execute').expect(200);
    expect(prisma.decision.findFirst.mock.calls[0][0].select)
      .toMatchObject({ id: true, executedAt: true, dismissedAt: true });
  });
});

describe('workspace scope', () => {
  // Not a nicety. Without the guard the WHERE loses its workspace predicate and
  // findFirst matches the newest PROPOSED row for that entityId in ANY account —
  // so an unresolved workspace would stamp a stranger's decision.
  it('400s when no workspace resolved, and reads nothing', async () => {
    const res = await send('execute', { workspaceId: null }).expect(400);
    expect(res.body.error).toBe('NoWorkspace');
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  it('scopes the read to the caller workspace', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    await send('dismiss', { workspaceId: 'ws-9' }).expect(200);
    expect(prisma.decision.findFirst.mock.calls[0][0].where.workspaceId).toBe('ws-9');
  });
});

describe('the two signals', () => {
  it('execute stamps executedAt and reports recorded:true', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    const res = await send('execute').expect(200);

    expect(res.body).toMatchObject({ ok: true, recorded: true });
    expect(prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd-1' }, data: { executedAt: expect.any(Date) } }),
    );
  });

  it('dismiss stamps dismissedAt', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    await send('dismiss').expect(200);
    expect(prisma.decision.update.mock.calls[0][0].data).toHaveProperty('dismissedAt');
  });

  // status is NOT moved. Four readers gate on PROPOSED; flipping it would evict
  // the decision from the feed, the agenda and the two by-entity stamps.
  it('never touches status', async () => {
    prisma.decision.findFirst.mockResolvedValue(live());
    await send('execute').expect(200);
    expect(prisma.decision.update.mock.calls[0][0].data).not.toHaveProperty('status');
  });
});

describe('the shared tail — inherited, not re-implemented', () => {
  it('idempotent: a second click reports the ORIGINAL timestamp and writes nothing', async () => {
    prisma.decision.findFirst.mockResolvedValue(live({ executedAt: AT }));
    const res = await send('execute').expect(200);

    expect(res.body).toMatchObject({ ok: true, recorded: false });
    expect(new Date(res.body.executedAt)).toEqual(AT);
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it.each([
    ['dismiss', { executedAt: AT },  'AlreadyExecuted'],
    ['execute', { dismissedAt: AT }, 'AlreadyDismissed'],
  ])('%s on an already-%s decision is a 409 naming the state', async (signal, stamped, code) => {
    prisma.decision.findFirst.mockResolvedValue(live(stamped));
    const res = await send(signal).expect(409);

    expect(res.body.error).toBe(code);
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });
});

describe('role + failure', () => {
  // A CLIENT seat is read-only by construction: their view is not an operator's
  // intent, and letting it seed the scored population would put someone who
  // cannot act in the denominator of "were we right".
  it.each([['execute'], ['dismiss']])('403s a CLIENT seat on %s', async (signal) => {
    await send(signal, { collabRole: 'CLIENT' }).expect(403);
    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
  });

  // Express 4 does not route an async rejection to the error handler, so an
  // unwrapped handler hangs the request rather than failing it.
  it('a DB failure is a 500, not an unhandled rejection', async () => {
    prisma.decision.findFirst.mockRejectedValue(new Error('connection lost'));
    const res = await send('execute').expect(500);
    expect(res.body.error).toBe('DecisionUnavailable');
  });
});

// The reason every path in this router carries its own '/decisions' prefix.
// A path-less mount would collide with the siblings flat-mounted beside it —
// the bug that 403'd half the app in PR #226.
describe('flat-mount discipline', () => {
  it('does not shadow the explain/intent stamps at the same base', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: 'd-1', explainedAt: null });
    const res = await request(makeApp())
      .patch(`/api/lumi/decisions/by-entity/${ENTITY}/explain`).send({}).expect(200);

    expect(res.body).toMatchObject({ ok: true, recorded: true });
    expect(prisma.decision.update.mock.calls[0][0].data).toHaveProperty('explainedAt');
  });
});
