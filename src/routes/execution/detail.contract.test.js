// ============================================================
// R13-D / B3-B — GET /api/execute/:id, against a real database
// ============================================================
// The direction #403 did not ship: execution → Decision.
//
// Every claim below is about a FK, a tenant boundary, or a timestamp that is
// either persisted or absent. A Prisma mock agrees with whatever the code asks
// it for, so under one of those none of these could fail — the FK would "hold"
// because nothing enforced it, and a deleted workspace predicate would return
// the row the mock was told to return. This runs on the real generated client,
// the real migrated schema and the real role gate.
//
// Only the QUEUE is mocked, because Redis is not the subject and the read path
// never touches it. The router is mounted whole (index.js) rather than in
// isolation, which is deliberate: `GET /:id` matches any single segment and the
// mount contains four literal single-segment routes it could swallow. Test 3
// exists for exactly that.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Redis is not the subject. Everything else is real.
vi.mock('../../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0) },
  actionQueue: null,
  observerQueue: null,
  syncQueue: null,
  enqueueExecution: vi.fn().mockResolvedValue({ id: 'job-1' }),
  enqueueAction: vi.fn(),
  EXECUTION_QUEUE_NAME: 'executions',
  ACTION_QUEUE_NAME: 'actions',
}));

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');
const executionRouter = (await import('./index.js')).default;

const DB_OK = await dbAvailable();

const WS       = '00000000-0000-4000-8000-00000000b3b0';
const OTHER_WS = '00000000-0000-4000-8000-00000000b3b1';
const ENTITY   = '00000000-0000-4000-8000-00000000b3b2';

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = workspaceId;
    req.collabRole  = collabRole;
    req.userId      = 'user-b3b';
    next();
  });
  app.use('/api/execute', executionRouter);
  return app;
}
const getDetail = (id, opts) => request(makeApp(opts)).get(`/api/execute/${id}`);

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B3-B fixture',
    channel: 'META', objective: 'OUTCOME_SALES', ...over,
  },
  select: { id: true },
});

const makeExecution = (over = {}) => prisma.executionRequest.create({
  data: {
    workspaceId: WS, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
    actionType: 'PAUSE_CAMPAIGN', targetId: '23851234567', status: 'QUEUED', ...over,
  },
  select: { id: true, decisionId: true, status: true },
});

const makeTransition = (executionId, toStatus, over = {}) => prisma.executionTransition.create({
  data: {
    executionId, workspaceId: WS,
    fromStatus: 'PENDING', toStatus, actor: 'WORKER',
    previousVersion: 0, newVersion: 1, ...over,
  },
});

// NOT skippable — an absent database must not read as a passing contract.
describe('B3-B — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B3-B — execution → decision read path', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `B3B ${id.slice(-4)}` } });
    }
  });
  afterAll(async () => {
    await prisma.executionTransition.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });
  beforeEach(async () => {
    await prisma.executionTransition.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  // ── §5: the link, by id ────────────────────────────────────────────────────
  it('1. an execution names the decision it carries out', async () => {
    const d = await makeDecision();
    const e = await makeExecution({ decisionId: d.id });

    const res = await getDetail(e.id);
    expect(res.status).toBe(200);
    expect(res.body.executionId).toBe(e.id);
    expect(res.body.decisionId).toBe(d.id);
    expect(res.body.decision.decisionId).toBe(d.id);
    expect(res.body.decision.verdict).toBe('KILL');
    // Workspace-safe identity: ids and enums, never a name.
    expect(res.body.decision.entityId).toBe(ENTITY);
    expect(res.body.decision.entityLevel).toBe('CAMPAIGN');
  });

  it('2. an unattributed execution returns null, never "Unknown"', async () => {
    const e = await makeExecution({ decisionId: null });
    const res = await getDetail(e.id);
    expect(res.status).toBe(200);
    expect(res.body.decisionId).toBeNull();
    expect(res.body.decision).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Unknown/i);
  });

  // ── Route ordering ─────────────────────────────────────────────────────────
  it('3. GET /:id does not swallow the literal single-segment routes', async () => {
    // `/active` is a real endpoint on this same mount. If registration order
    // ever puts `/:id` first, this returns a 404 for an execution named
    // "active" instead of the active-executions list.
    const res = await request(makeApp()).get('/api/execute/active');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('executionId');
  });

  // ── Tenancy, both predicates ───────────────────────────────────────────────
  it('4. another workspace\'s execution is a 404, not a 403', async () => {
    const e = await makeExecution({ workspaceId: OTHER_WS });
    const res = await getDetail(e.id);
    expect(res.status).toBe(404);
    // Identical to a nonexistent id, so the response cannot enumerate ids.
    expect((await getDetail('nonexistent-execution-id')).status).toBe(404);
  });

  it('5. a cross-workspace decisionId never resolves into the payload', async () => {
    // The FK targets decisions.id alone and carries NO tenant component, so the
    // database permits this row. Only the route's second predicate refuses it.
    // Without that predicate the response would carry another workspace's
    // verdict and entity id.
    const foreign = await makeDecision({ workspaceId: OTHER_WS });
    const e = await makeExecution({ decisionId: foreign.id });

    const res = await getDetail(e.id);
    expect(res.status).toBe(200);
    // The column is the row's own and is reported honestly…
    expect(res.body.decisionId).toBe(foreign.id);
    // …but nothing from the other workspace's decision is resolved.
    expect(res.body.decision).toBeNull();
  });

  it('6. the database itself permitted that cross-tenant link — application-enforced', async () => {
    // Stated as a finding, proven by test 5 having created the row at all. If a
    // migration ever adds a composite FK, test 5 fails at the create and this
    // is where to look.
    const foreign = await makeDecision({ workspaceId: OTHER_WS });
    const e = await makeExecution({ decisionId: foreign.id });
    const row = await prisma.executionRequest.findUnique({
      where: { id: e.id }, select: { decisionId: true },
    });
    expect(row.decisionId).toBe(foreign.id);
  });

  // ── Lifecycle timestamps come from transitions, or are null ────────────────
  it('7. lifecycle moments are read from the transition log', async () => {
    const e = await makeExecution({ status: 'EXECUTED_SUCCESS' });
    await makeTransition(e.id, 'QUEUED');
    await new Promise((r) => setTimeout(r, 5));
    await makeTransition(e.id, 'EXECUTING');
    await new Promise((r) => setTimeout(r, 5));
    await makeTransition(e.id, 'EXECUTED_SUCCESS');

    const res = await getDetail(e.id);
    expect(res.body.queuedAt).toBeTruthy();
    expect(res.body.startedAt).toBeTruthy();
    expect(res.body.succeededAt).toBeTruthy();
    expect(new Date(res.body.queuedAt) <= new Date(res.body.startedAt)).toBe(true);
    expect(new Date(res.body.startedAt) <= new Date(res.body.succeededAt)).toBe(true);
    expect(res.body.state).toBe('SUCCEEDED');
  });

  it('8. a queued execution has NO success timestamp and does not read as done', async () => {
    // The assertion this whole slice exists for: accepted is not executed.
    const e = await makeExecution({ status: 'QUEUED' });
    await makeTransition(e.id, 'QUEUED');

    const res = await getDetail(e.id);
    expect(res.body.state).toBe('QUEUED');
    expect(res.body.succeededAt).toBeNull();
    expect(res.body.startedAt).toBeNull();
    expect(res.body.terminal).toBe(false);
    expect(res.body.failure).toBeNull();
  });

  it('9. no transitions at all ⇒ every derived timestamp is null, none invented', async () => {
    const e = await makeExecution({ status: 'PENDING' });
    const res = await getDetail(e.id);
    expect(res.body.queuedAt).toBeNull();
    expect(res.body.startedAt).toBeNull();
    expect(res.body.succeededAt).toBeNull();
    expect(res.body.failedAt).toBeNull();
    // requestedAt is a real column, so it is present.
    expect(res.body.requestedAt).toBeTruthy();
    expect(res.body.state).toBe('REQUESTED');
  });

  // ── Failure detail, whitelisted ────────────────────────────────────────────
  it('10. a failure reports message, code and platform status by name', async () => {
    const e = await makeExecution({
      status: 'EXECUTED_FAILED',
      response: { error: 'Invalid parameter', code: 100 },
    });
    await makeTransition(e.id, 'EXECUTED_FAILED', {
      metadata: { platformStatus: 400, reason: 'non_retriable', workerId: 1234 },
    });

    const res = await getDetail(e.id);
    expect(res.body.state).toBe('FAILED');
    expect(res.body.failure.message).toBe('Invalid parameter');
    expect(res.body.failure.code).toBe(100);
    expect(res.body.failure.platformStatus).toBe(400);
    expect(res.body.failure.reason).toBe('non_retriable');
  });

  it('11. neither the request payload nor the raw platform response is published', async () => {
    const e = await makeExecution({
      status: 'EXECUTED_SUCCESS',
      payload:  { secret: 'do-not-publish' },
      response: { token: 'do-not-publish' },
    });
    const res = await getDetail(e.id);
    expect(JSON.stringify(res.body)).not.toMatch(/do-not-publish/);
    // …but a reader still learns a response was persisted.
    expect(res.body.hasResponse).toBe(true);
  });

  it('12. a timeout is not reported as a platform refusal', async () => {
    const e = await makeExecution({ status: 'TIMED_OUT' });
    const res = await getDetail(e.id);
    expect(res.body.state).toBe('TIMED_OUT');
    expect(res.body.state).not.toBe('FAILED');
    expect(res.body.terminal).toBe(true);
  });

  // ── Retry lineage ──────────────────────────────────────────────────────────
  it('13. a retry is a separate execution that names its parent', async () => {
    const d = await makeDecision();
    const original = await makeExecution({ decisionId: d.id, status: 'EXECUTED_FAILED' });
    const retry = await makeExecution({
      decisionId: d.id, status: 'QUEUED',
      retryMetadata: { retryOf: original.id, retryDepth: 1, retriedAt: new Date().toISOString() },
    });

    const retryRes = await getDetail(retry.id);
    expect(retryRes.body.retryOf).toBe(original.id);
    expect(retryRes.body.retryDepth).toBe(1);
    // Both carry the same decision — one call, two attempts.
    expect(retryRes.body.decisionId).toBe(d.id);

    const originalRes = await getDetail(original.id);
    expect(originalRes.body.retryOf).toBeNull();
    expect(originalRes.body.retryDepth).toBe(0);
    // Two distinct rows, not one collapsed record.
    expect(originalRes.body.executionId).not.toBe(retryRes.body.executionId);
  });

  // ── Decision.executedAt is not platform truth ──────────────────────────────
  it('14. a self-reported decision does NOT make its execution read as succeeded', async () => {
    // The §6 invariant. Decision.executedAt is written both by the worker after
    // a real mutation and by the self-report route when a human says they acted
    // by hand. Deriving success from it would call an operator's claim a Meta
    // confirmation.
    const d = await makeDecision({ executedAt: new Date('2026-08-19T10:00:00Z') });
    const e = await makeExecution({ decisionId: d.id, status: 'QUEUED' });

    const res = await getDetail(e.id);
    expect(res.body.state).toBe('QUEUED');
    expect(res.body.succeededAt).toBeNull();
    // Published, but under a name that says what it is.
    expect(res.body.decision.selfReportedOrExecutedAt).toBeTruthy();
    expect(res.body.decision).not.toHaveProperty('executedAt');
  });

  // ── FK behaviour ───────────────────────────────────────────────────────────
  it('15. deleting the Decision nulls the link and keeps the execution', async () => {
    const d = await makeDecision();
    const e = await makeExecution({ decisionId: d.id });
    await prisma.decision.delete({ where: { id: d.id } });

    const res = await getDetail(e.id);
    expect(res.status).toBe(200);
    expect(res.body.decisionId).toBeNull();
    expect(res.body.decision).toBeNull();
  });

  // ── Authorization ──────────────────────────────────────────────────────────
  it('16. a CLIENT cannot read the execution log', async () => {
    const e = await makeExecution();
    const res = await getDetail(e.id, { collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/PAUSE_CAMPAIGN|23851234567/);
  });

  it('17. a STRATEGIST can', async () => {
    const e = await makeExecution();
    expect((await getDetail(e.id, { collabRole: 'STRATEGIST' })).status).toBe(200);
  });
});
