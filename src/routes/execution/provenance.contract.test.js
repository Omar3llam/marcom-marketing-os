// ============================================================
// R13-D / B4-A — four facts, and none of them implies another
// ============================================================
// T1–T8, against a real database. The thing being proven is a set of NON-
// implications, which is why every test asserts what did NOT happen as hard as
// what did:
//
//   a human self-report   ≠  Lumi executed something
//   an execution request  ≠  an execution succeeded
//   an execution success  ≠  the decision was right
//   a dismissal           ≠  a bad outcome
//
// A Prisma mock cannot fail any of these — it returns whatever it was told to,
// including for the workspace predicates and the two provenance columns — so
// everything below runs on the real generated client and the real migrated
// schema. Only the queue and the Meta call are doubled: neither is the subject.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const enqueueExecution = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));
vi.mock('../../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0) },
  enqueueExecution,
  observerQueue: null, syncQueue: null,
  EXECUTION_QUEUE_NAME: 'executions',
}));

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');
const executionRouter = (await import('./index.js')).default;
const { decisionsRouter } = await import('../lumi/decisions.js');
const { stampDecisionExecuted } = await import('../../services/execution/decisionAttribution.js');
const { loadExecutability, NOT_EXECUTABLE } = await import('../../services/execution/decisionEligibility.js');

const DB_OK = await dbAvailable();

const WS     = '00000000-0000-4000-8000-00000000b4a0';
const ENTITY = '00000000-0000-4000-8000-00000000b4a1';

function app(router, mount, { collabRole = 'BUYER', userRole = 'MEMBER' } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.workspaceId = WS; req.collabRole = collabRole;
    req.userId = 'user-b4a'; req.userRole = userRole;
    next();
  });
  a.use(mount, router);
  return a;
}

const selfReport = (id) => request(app(decisionsRouter, '/api/lumi')).patch(`/api/lumi/decisions/${id}/execute`).send({});
const execute = (decisionId, key) => request(app(executionRouter, '/api/execute'))
  .post('/api/execute/meta')
  .send({
    actionType: 'PAUSE_CAMPAIGN', targetId: '23851234567', targetType: 'campaign',
    idempotencyKey: key ?? `k-${Math.random().toString(36).slice(2)}`,
    ...(decisionId ? { decisionId } : {}),
  });

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B4-A fixture',
    channel: 'META', objective: 'OUTCOME_SALES', status: 'PROPOSED', ...over,
  },
  select: { id: true },
});

const readDecision = (id) => prisma.decision.findUnique({
  where: { id },
  select: { humanExecutedAt: true, platformExecutedAt: true, dismissedAt: true, status: true },
});

const countExecutions = () => prisma.executionRequest.count({ where: { workspaceId: WS } });

describe('B4-A — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B4-A — execution provenance', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'B4A' } });
  });
  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: WS } });
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    enqueueExecution.mockResolvedValue({ id: 'job-1' });
    await prisma.executionRequest.deleteMany({ where: { workspaceId: WS } });
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
  });

  // ── T1 ────────────────────────────────────────────────────────────────────
  it('T1 · a human self-report is not a platform execution', async () => {
    const d = await makeDecision();
    const before = await countExecutions();

    const res = await selfReport(d.id);
    expect(res.status).toBe(200);

    const row = await readDecision(d.id);
    expect(row.humanExecutedAt).toBeTruthy();
    // The assertion this whole slice exists for.
    expect(row.platformExecutedAt).toBeNull();
    // …and no execution was created or queued on the operator's word.
    expect(await countExecutions()).toBe(before);
    expect(enqueueExecution).not.toHaveBeenCalled();
  });

  it('T1b · the self-report response states both axes, so nothing is inferred', async () => {
    const d = await makeDecision();
    const { body } = await selfReport(d.id);
    expect(body.humanExecution).toEqual({ reported: true, reportedAt: expect.any(String) });
    // Stated as null, not omitted: "we looked and Lumi has not executed this".
    expect(body.platformExecution).toBeNull();
  });

  it('T11-T4 · this route\u2019s executedAt alias stays HUMAN-only, by design', async () => {
    // Three surfaces publish a deprecated field called `executedAt` and they do
    // NOT all mean the same thing. Two derive `platformExecutedAt ??
    // humanExecutedAt`; this one returns the human instant IT just wrote,
    // because a self-report can only ever record a human execution — answering
    // "I did this myself" with Lumi's timestamp would answer a different
    // question.
    //
    // The fixture is already platform-executed, which is the only state where
    // the two derivations disagree. Without it this test would pass against
    // either one and prove nothing.
    //
    // T12-A · routes/lumi/signalProjection.contract.test.js reuses this exact
    // state to prove the other half — that the response also REPORTS the
    // platform execution it must not adopt as its alias. Change one, read both.
    const PLATFORM = new Date('2026-08-01T00:00:00.000Z');
    const d = await makeDecision({ platformExecutedAt: PLATFORM });

    const { status, body } = await selfReport(d.id);
    expect(status).toBe(200);

    expect(body.executedAt).toBe(body.humanExecutedAt);
    expect(new Date(body.executedAt).getTime()).not.toBe(PLATFORM.getTime());

    // The stored columns are untouched by the shape of the response: the human
    // report is recorded, and Lumi's earlier execution is neither overwritten
    // nor re-dated.
    const row = await readDecision(d.id);
    expect(row.humanExecutedAt).toBeTruthy();
    expect(row.platformExecutedAt).toEqual(PLATFORM);
  });

  it('T1c · engagement signals touch NEITHER execution fact', async () => {

    // explain and intent record that a human READ a verdict and carried it
    // somewhere they could act. Reading is not acting, and neither is opening
    // the ad platform — so neither may write an execution timestamp of either
    // kind. They share a write helper with the execute signal, which is exactly
    // why this needs its own guard: a change to the shared tail reaches all four.
    const d = await makeDecision();
    const byEntity = request(app(decisionsRouter, '/api/lumi'));
    await byEntity.patch(`/api/lumi/decisions/by-entity/${ENTITY}/explain`).send({});
    await request(app(decisionsRouter, '/api/lumi'))
      .patch(`/api/lumi/decisions/by-entity/${ENTITY}/intent`).send({});

    const row = await prisma.decision.findUnique({
      where: { id: d.id },
      select: { explainedAt: true, intentAt: true, humanExecutedAt: true, platformExecutedAt: true },
    });
    expect(row.explainedAt).toBeTruthy();
    expect(row.intentAt).toBeTruthy();
    expect(row.humanExecutedAt).toBeNull();
    expect(row.platformExecutedAt).toBeNull();
  });

  // ── T2 ────────────────────────────────────────────────────────────────────
  it('T2 · a successful Lumi execution is not a human self-report', async () => {
    const d = await makeDecision();
    await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id, at: new Date('2026-08-20T10:00:00Z') });

    const row = await readDecision(d.id);
    expect(row.platformExecutedAt).toEqual(new Date('2026-08-20T10:00:00Z'));
    // Lumi acting does not put words in the operator's mouth.
    expect(row.humanExecutedAt).toBeNull();
  });

  it('T2b · the two facts coexist without overwriting each other', async () => {
    // An operator can act by hand and later run the same call through Lumi.
    // Neither write clears the other; they are independent records.
    const d = await makeDecision();
    await selfReport(d.id);
    await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id, at: new Date('2026-08-20T11:00:00Z') });

    const row = await readDecision(d.id);
    expect(row.humanExecutedAt).toBeTruthy();
    expect(row.platformExecutedAt).toEqual(new Date('2026-08-20T11:00:00Z'));
  });

  // ── T3 ────────────────────────────────────────────────────────────────────
  it('T3 · a queued request stamps nothing — a receipt is not a result', async () => {
    const d = await makeDecision();
    const res = await execute(d.id);
    expect(res.status).toBe(202);

    const row = await readDecision(d.id);
    // The request exists; the platform has not been called.
    expect(await countExecutions()).toBe(1);
    expect(row.platformExecutedAt).toBeNull();
    expect(row.humanExecutedAt).toBeNull();
  });

  it('T3b · a failed execution creates no success fact', async () => {
    const d = await makeDecision();
    await execute(d.id);
    await prisma.executionRequest.updateMany({
      where: { decisionId: d.id }, data: { status: 'EXECUTED_FAILED' },
    });
    // Nothing stamps on failure — stampDecisionExecuted is only ever called on
    // the worker's success branch, and no other writer exists.
    expect((await readDecision(d.id)).platformExecutedAt).toBeNull();
  });

  // ── T4 ────────────────────────────────────────────────────────────────────
  it('T4 · a dismissed decision cannot execute — no row, no job', async () => {
    const d = await makeDecision({ dismissedAt: new Date() });

    const res = await execute(d.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DECISION_NOT_EXECUTABLE');
    expect(res.body.reason).toBe(NOT_EXECUTABLE.DISMISSED);

    // The refusal leaves NOTHING behind: no ExecutionRequest, no queue job.
    // Refusing after creating the row would still put a real mutation in flight.
    expect(await countExecutions()).toBe(0);
    expect(enqueueExecution).not.toHaveBeenCalled();
  });

  // ── T5 ────────────────────────────────────────────────────────────────────
  it('T5 · a superseded decision cannot execute', async () => {
    // The repository's real supersession representation: VerdictService sets
    // status SUPERSEDED on the replaced row when a new verdict lands.
    const d = await makeDecision({ status: 'SUPERSEDED', resolvedAt: new Date() });

    const res = await execute(d.id);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe(NOT_EXECUTABLE.SUPERSEDED);
    expect(await countExecutions()).toBe(0);
    expect(enqueueExecution).not.toHaveBeenCalled();
  });

  it('T5b · a live decision still executes — the gate is not a blanket refusal', async () => {
    const d = await makeDecision();
    const res = await execute(d.id);
    expect(res.status).toBe(202);
    expect(await countExecutions()).toBe(1);
  });

  it('T5c · an unattributed execution is unaffected by the gate', async () => {
    // Acting directly on a campaign names no decision, so there is no decision
    // lifecycle to violate. Refusing these would break a legitimate path.
    const res = await execute(null);
    expect(res.status).toBe(202);
    expect(await countExecutions()).toBe(1);
  });

  // ── T6 — the race the route alone cannot close ────────────────────────────
  it('T6 · a decision dismissed AFTER queueing is refused at mutation time', async () => {
    const d = await makeDecision();
    await execute(d.id);                                   // 1+2. create + queue
    expect(await loadExecutability(WS, d.id)).toEqual({ executable: true, reason: null });

    await prisma.decision.update({                          // 3. it goes stale
      where: { id: d.id }, data: { dismissedAt: new Date() },
    });

    // 4. what the worker asks immediately before calling Meta.
    const recheck = await loadExecutability(WS, d.id);
    expect(recheck.executable).toBe(false);
    expect(recheck.reason).toBe(NOT_EXECUTABLE.DISMISSED);
    // …and nothing was stamped, because no mutation may follow that answer.
    expect((await readDecision(d.id)).platformExecutedAt).toBeNull();
  });

  it('T6b · a decision superseded AFTER queueing is refused at mutation time', async () => {
    const d = await makeDecision();
    await execute(d.id);
    await prisma.decision.update({ where: { id: d.id }, data: { status: 'SUPERSEDED' } });

    const recheck = await loadExecutability(WS, d.id);
    expect(recheck.executable).toBe(false);
    expect(recheck.reason).toBe(NOT_EXECUTABLE.SUPERSEDED);
  });

  it('T6c · a failed eligibility read refuses rather than assuming permission', async () => {
    // "We could not establish that this is still live" is not "this is live",
    // and only one of those may precede a real ad-platform mutation.
    const spy = vi.spyOn(prisma.decision, 'findFirst').mockRejectedValueOnce(new Error('db down'));
    const out = await loadExecutability(WS, '00000000-0000-4000-8000-0000000000ff');
    expect(out.executable).toBe(false);
    expect(out.reason).toBe(NOT_EXECUTABLE.LOOKUP_FAILED);
    spy.mockRestore();
  });

  // ── Tenancy ───────────────────────────────────────────────────────────────
  it('a decision in another workspace is not executable here', async () => {
    const d = await makeDecision();
    const out = await loadExecutability('00000000-0000-4000-8000-0000000000ee', d.id);
    expect(out.executable).toBe(false);
    expect(out.reason).toBe(NOT_EXECUTABLE.DECISION_NOT_FOUND);
  });

  it('stampDecisionExecuted never crosses a workspace boundary', async () => {
    const d = await makeDecision();
    const out = await stampDecisionExecuted({
      workspaceId: '00000000-0000-4000-8000-0000000000ee', decisionId: d.id,
    });
    expect(out.stamped).toBe(false);
    expect((await readDecision(d.id)).platformExecutedAt).toBeNull();
  });

  it('a dismissal is never overturned by a later platform success', async () => {
    const d = await makeDecision({ dismissedAt: new Date() });
    const out = await stampDecisionExecuted({ workspaceId: WS, decisionId: d.id });
    expect(out.stamped).toBe(false);
    expect((await readDecision(d.id)).platformExecutedAt).toBeNull();
  });

  // ── T7 ────────────────────────────────────────────────────────────────────
  it('T7 · the read path distinguishes the two without inference', async () => {
    const d = await makeDecision({ humanExecutedAt: new Date('2026-08-20T08:00:00Z') });
    const res = await request(app(executionRouter, '/api/execute'))
      .get(`/api/execute/${(await prisma.executionRequest.create({
        data: {
          workspaceId: WS, idempotencyKey: `k-${Math.random()}`, actionType: 'PAUSE_CAMPAIGN',
          targetId: '1', status: 'QUEUED', decisionId: d.id,
        },
        select: { id: true },
      })).id}`);

    expect(res.status).toBe(200);
    expect(res.body.decision.humanExecutedAt).toBeTruthy();
    expect(res.body.decision.platformExecutedAt).toBeNull();
    // No ambiguous field remains for a client to misread.
    expect(res.body.decision).not.toHaveProperty('executedAt');
    expect(res.body.decision).not.toHaveProperty('selfReportedOrExecutedAt');
  });

  // ── T8 ────────────────────────────────────────────────────────────────────
  it('T8 · an outcome does not imply an execution, and vice versa', async () => {
    // An outcome hangs off the DECISION, never off an execution (B4 §8). These
    // two facts are recorded by different actors from different evidence, and
    // neither one may be read as the other.
    const withOutcome = await makeDecision({ humanExecutedAt: new Date('2026-08-01T00:00:00Z') });
    await prisma.outcomeSnapshot.create({
      data: {
        workspaceId: WS, decisionId: withOutcome.id, entityId: ENTITY, entityLevel: 'CAMPAIGN',
        spendDeltaMinor: -5000, windowStart: new Date('2026-08-01T00:00:00Z'),
        windowEnd: new Date('2026-08-08T00:00:00Z'), sustained: true,
      },
    });
    // An outcome exists; Lumi executed nothing.
    expect((await readDecision(withOutcome.id)).platformExecutedAt).toBeNull();
    expect(await prisma.executionRequest.count({ where: { decisionId: withOutcome.id } })).toBe(0);

    // And the converse: an executed decision with no outcome recorded.
    const executed = await makeDecision();
    await stampDecisionExecuted({ workspaceId: WS, decisionId: executed.id });
    expect((await readDecision(executed.id)).platformExecutedAt).toBeTruthy();
    expect(await prisma.outcomeSnapshot.count({ where: { decisionId: executed.id } })).toBe(0);
  });
});
