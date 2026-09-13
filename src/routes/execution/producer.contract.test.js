// ============================================================
// R13-D / B3 — the producer, end to end, against a real database
// ============================================================
// Discovery proved this route was complete and had never been called: production
// held zero `execution_requests`. B3 wires the product to it, so the chain it
// creates has to be proven against real rows rather than a mock that agrees
// with whatever the route asks for.
//
// ONLY THE QUEUE IS MOCKED. BullMQ needs Redis and the enqueue is not the claim
// under test; everything else — Prisma, the lifecycle service, the role gate,
// resolveAttribution — is production's own code.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const { enqueueExecution, executionQueue } = vi.hoisted(() => ({
  enqueueExecution: vi.fn(async () => ({ id: 'job-1' })),
  executionQueue: { count: vi.fn(async () => 0) },
}));
vi.mock('../../queues/index.js', () => ({ enqueueExecution, executionQueue }));
// Slice B: /meta and /:id/retry now re-confirm the credential with the issuer at
// the money boundary. The issuer is not the claim under test here, so it answers
// "still valid"; revocation itself is proven in src/tests/authorizationFreshness.*.
vi.mock('../../utils/firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'contract-user' }) }) },
  getFirebaseAdminReadiness: () => ({ ok: true, error: null }),
}));


const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const executionRouter = (await import('./index.js')).default;

const DB_OK = await dbAvailable();

const WS       = '00000000-0000-4000-8000-00000000b3f0';
const OTHER_WS = '00000000-0000-4000-8000-00000000b3f1';
const ENTITY   = '00000000-0000-4000-8000-00000000b3fe';
const USER     = '00000000-0000-4000-8000-00000000b3fu'.replace('u', '9');

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = workspaceId; req.collabRole = collabRole; req.userId = USER;
    req.headers.authorization = 'Bearer contract-token';  // requireAuth ran upstream
    next();
  });
  app.use('/api/execute', executionRouter);
  return app;
}

/**
 * Slice B: the money boundary reads the CURRENT role from the user row rather
 * than trusting req.collabRole, so this contract test — which runs the real
 * gate against the real database — has to put the role where the gate looks.
 */
async function seatAs(collabRole, workspaceId = WS) {
  await prisma.user.upsert({
    where:  { clerkId: USER },
    update: { collabRole, workspaceId },
    create: { clerkId: USER, email: 'b3-producer@contract.local', workspaceId, collabRole },
  });
}

const post = async (body, opts) => {
  await seatAs(opts?.collabRole ?? 'BUYER', opts?.workspaceId ?? WS);
  return request(makeApp(opts)).post('/api/execute/meta').send(body);
};

const validBody = (over = {}) => ({
  actionType: 'PAUSE_CAMPAIGN',
  targetId: '23851234567',
  targetType: 'campaign',
  idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
  ...over,
});

const makeDecision = (workspaceId = WS) => prisma.decision.create({
  data: {
    workspaceId, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B3 producer fixture', channel: 'META',
  },
  select: { id: true, platformExecutedAt: true },
});

describe('B3 producer — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B3 — Decision → ExecutionRequest, persisted', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `B3P ${id.slice(-4)}` } });
    }
  });
  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.user.deleteMany({ where: { clerkId: USER } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    enqueueExecution.mockResolvedValue({ id: 'job-1' });
    executionQueue.count.mockResolvedValue(0);
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  // ── The audit row, against the real enum ──────────────────────────────────
  // This suite is the only place that can prove it. Every other execution-route
  // suite mocks `prisma.auditLog.create` with a resolved stub, which agrees
  // with any value at all — including one the column cannot store.
  //
  // It could not store `'QUEUED'`: AuditLog.status is Prisma's `ExecutionStatus`
  // enum (PENDING | SUCCESS | FAILED | …), a different type from the
  // execution-lifecycle enum of the same name that owns QUEUED. Prisma rejected
  // the write, the route's `.catch` logged it, and the request returned 202
  // anyway — so a successful enqueue produced no audit row at all, on every
  // request, invisibly.
  it('0. a successful enqueue PERSISTS an audit row the column can hold', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(202);

    const rows = await prisma.auditLog.findMany({
      where: { workspaceId: WS },
      select: { status: true, actionType: true, targetId: true, platform: true },
    });

    // The assertion the mocks could never make: a row exists.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].platform).toBe('META');
    expect(rows[0].actionType).toBe('PAUSE_CAMPAIGN');

    // And it is a value the enum actually admits — read back through the
    // generated client, which is what rejected the old one.
    const pendingOnly = await prisma.auditLog.count({ where: { workspaceId: WS, status: 'PENDING' } });
    expect(pendingOnly).toBe(1);
  });

  it('0b. the audit write is not silently absent when the enum rejects a value', async () => {
    // A guard against the failure MODE, not just the value: prove that the
    // column really does refuse a runtime-lifecycle word, so a future edit
    // reaching for one cannot pass unnoticed the way the last one did.
    await expect(prisma.auditLog.create({
      data: {
        workspaceId: WS, userId: USER, actionType: 'PAUSE_CAMPAIGN',
        targetId: '23851234567', platform: 'META', status: 'QUEUED', payload: {},
      },
    })).rejects.toThrow(/ExecutionStatus/);
  });

  it('1. a decisionId is attributed and PERSISTED on the row', async () => {

    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id }));
    expect(res.status).toBe(202);

    const rows = await prisma.executionRequest.findMany({
      where: { workspaceId: WS }, select: { id: true, decisionId: true, status: true, workspaceId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].decisionId).toBe(d.id);
    expect(rows[0].workspaceId).toBe(WS);
  });

  it('2. the row reaches QUEUED and the job is enqueued by its id', async () => {
    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id }));

    const row = await prisma.executionRequest.findFirst({ where: { workspaceId: WS } });
    expect(row.status).toBe('QUEUED');
    expect(enqueueExecution).toHaveBeenCalledTimes(1);
    expect(enqueueExecution.mock.calls[0][0].executionId).toBe(row.id);
    expect(res.body.executionId).toBe(row.id);
  });

  it('3. the 202 does NOT claim the mutation happened', async () => {
    // The single most important thing this response must not say. Meta has not
    // been called; the worker has not run. A client rendering "executed" from
    // this would show a paused campaign that is still spending.
    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id }));
    expect(res.status).toBe(202);
    expect(res.body.status).not.toBe('EXECUTED_SUCCESS');
    expect(JSON.stringify(res.body)).not.toMatch(/EXECUTED_SUCCESS/);

    // …and the Decision is NOT stamped. platformExecutedAt is worker-written, after the
    // platform accepted the mutation, and nothing earlier may set it.
    const after = await prisma.decision.findUnique({ where: { id: d.id }, select: { platformExecutedAt: true } });
    expect(after.platformExecutedAt).toBeNull();
  });

  it('4. a decision from ANOTHER workspace is refused, not executed unattributed', async () => {
    const foreign = await makeDecision(OTHER_WS);
    const res = await post(validBody({ decisionId: foreign.id }));

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ATTRIBUTION_UNRESOLVED');
    // Nothing was queued and nothing was written. Downgrading to an
    // unattributed execution would produce a real mutation the Proof Engine
    // could never see — the exact gap R10 closed.
    expect(await prisma.executionRequest.count({ where: { workspaceId: WS } })).toBe(0);
    expect(enqueueExecution).not.toHaveBeenCalled();
  });

  it('5. an unknown decisionId is refused the same way', async () => {
    const res = await post(validBody({ decisionId: '00000000-0000-4000-8000-0000000000ff' }));
    expect(res.status).toBe(422);
    expect(await prisma.executionRequest.count({ where: { workspaceId: WS } })).toBe(0);
  });

  it('6. no decisionId is allowed, and lands an honestly unattributed row', async () => {
    // A normal operator path: acting on a campaign no sweep has judged. The
    // row records that it carries out no decision, rather than inventing one.
    const res = await post(validBody());
    expect(res.status).toBe(202);
    const row = await prisma.executionRequest.findFirst({ where: { workspaceId: WS } });
    expect(row.decisionId).toBeNull();
  });

  it('7. a CLIENT cannot queue a platform mutation', async () => {
    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id }), { collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    expect(await prisma.executionRequest.count({ where: { workspaceId: WS } })).toBe(0);
    expect(enqueueExecution).not.toHaveBeenCalled();
  });

  it('8. a uuid in targetId is refused — Meta is addressed by its own id', async () => {
    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id, targetId: ENTITY }));
    expect(res.status).toBe(400);
    expect(await prisma.executionRequest.count({ where: { workspaceId: WS } })).toBe(0);
  });

  it('9. the same idempotency key does not create a second execution', async () => {
    const d = await makeDecision();
    const body = validBody({ decisionId: d.id });
    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(202);
    expect(await prisma.executionRequest.count({ where: { workspaceId: WS } })).toBe(1);
    // Whatever shape the replay takes, it must not be a second queued mutation.
    expect(second.status).not.toBe(500);
    expect(enqueueExecution).toHaveBeenCalledTimes(1);
  });

  it('10. SC-2 · the legacy Action substrate cannot be touched — it is gone', async () => {
    // The negative control B3 §17 asks for. It used to count `actions` rows
    // before and after a queue, proving the new path did not write to the
    // substrate whose stub executors reported success without calling a
    // platform.
    //
    // SC-2 dropped the table after production measured it at 0 rows, so the
    // control inverts: there is no count to take, and a write is impossible
    // rather than merely absent. The run below still exercises the whole
    // producer path, so a reintroduced Action write would surface here and
    // not only in a source ratchet.
    expect(prisma.action).toBeUndefined();

    const d = await makeDecision();
    const res = await post(validBody({ decisionId: d.id }));
    expect(res.status).toBe(202);
  });
});

// ============================================================
// The other end of the chain: only a REAL success stamps the Decision
// ============================================================
// platformExecutedAt is the column the whole Proof Engine population derives from, and
// the worker is the only thing that writes it from an execution. Every existing
// test of that mocked Prisma — so the conditional WHERE that makes it
// first-success-only, and that refuses to overturn a dismissal, had never been
// executed by a database.
// ============================================================
describe.skipIf(!DB_OK)('B3 — stampDecisionExecuted, against real rows', () => {
  let stampDecisionExecuted;
  beforeAll(async () => {
    ({ stampDecisionExecuted } = await import('../../services/execution/decisionAttribution.js'));
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: 'B3P' } });
    }
  });
  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  it('stamps on the first success', async () => {
    const d = await makeDecision();
    const at = new Date('2026-08-19T12:00:00Z');
    const r = await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id, at });

    expect(r).toEqual({ stamped: true, reason: 'STAMPED' });
    const after = await prisma.decision.findUnique({ where: { id: d.id }, select: { platformExecutedAt: true } });
    expect(after.platformExecutedAt).toEqual(at);
  });

  it('a SECOND success does not re-date it', async () => {
    // One Decision can own several executions — retries, or the same call acted
    // on twice. platformExecutedAt records WHEN the operator first acted, not how often.
    // This is also what makes the worker safe for BullMQ to deliver twice.
    const d = await makeDecision();
    const first = new Date('2026-08-19T12:00:00Z');
    await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id, at: first });
    const again = await stampDecisionExecuted({
      workspaceId: WS, decisionId: d.id, at: new Date('2026-08-20T12:00:00Z'),
    });

    expect(again).toEqual({ stamped: false, reason: 'ALREADY_RESOLVED' });
    const after = await prisma.decision.findUnique({ where: { id: d.id }, select: { platformExecutedAt: true } });
    expect(after.platformExecutedAt).toEqual(first);
  });

  it('NEVER overturns an explicit dismissal', async () => {
    // A decision the operator rejected must not become "executed" because an
    // unrelated execution named it. Enforced in the WHERE, so a concurrent
    // dismissal cannot slip between a check and a write.
    const d = await prisma.decision.create({
      data: {
        workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN', verdict: 'KILL',
        confidence: 0.8, diagnosis: 'dismissed', dismissedAt: new Date('2026-08-18T09:00:00Z'),
      },
      select: { id: true },
    });

    const r = await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id });
    expect(r.stamped).toBe(false);
    const after = await prisma.decision.findUnique({ where: { id: d.id }, select: { platformExecutedAt: true } });
    expect(after.platformExecutedAt).toBeNull();
  });

  it('cannot stamp a decision in another workspace', async () => {
    const foreign = await makeDecision(OTHER_WS);
    const r = await stampDecisionExecuted({ workspaceId: WS, decisionId: foreign.id });

    expect(r.stamped).toBe(false);
    const after = await prisma.decision.findUnique({ where: { id: foreign.id }, select: { platformExecutedAt: true } });
    expect(after.platformExecutedAt).toBeNull();
  });

  it('an unattributed execution stamps nothing, and says so', async () => {
    expect(await stampDecisionExecuted({ workspaceId: WS, decisionId: null }))
      .toEqual({ stamped: false, reason: 'NOT_ATTRIBUTED' });
  });
});
