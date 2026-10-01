// ============================================================
// B4-A — the decision lifecycle read path, against a real database
// ============================================================
// GET /api/lumi/decisions/:id/executions already answered three of the four
// questions the lifecycle asks. It could say what the decision was, what the
// human judged, and whether Lumi executed anything — separately, which is the
// hard part and was settled by the provenance split.
//
// It could not say whether anything CAME of it. `outcome_snapshots` carried an
// FK to `decisions`, a dedicated current-outcome index and a named selection
// seam, and this route projected none of it: a client could see that a KILL was
// executed and had no way to ask whether the kill worked.
//
// THE FOUR AXES, AND WHY NONE OF THEM IMPLIES ANOTHER
//
//   humanJudgment      what the operator thought of the call
//   humanExecution     a CLAIM that they acted. Not proof of anything.
//   platformExecution  Lumi's worker landed a real mutation. The only proof.
//   outcome            what was measured afterwards — by a human, later
//
// An executed decision may have no outcome, and an outcome may exist with no
// execution at all. The tests below assert the NON-implications as hard as the
// implications: a read path that quietly fills one axis from another is
// indistinguishable from a correct one until somebody trusts it.
//
// WHAT ABSENCE MUST LOOK LIKE
// `{ available: false }` and nothing else. Not a null-filled skeleton, which
// reads at a glance like a recorded result with missing values, and not zeroed
// metrics, which are a fabricated outcome rather than an absent one. A zero
// delta is a real measurement somebody made — it must be impossible for this
// route to produce one on its own.
//
// The D2 half of B4-A (a terminal decision may not enter the execution path)
// lives in routes/execution/provenance.contract.test.js T4/T5 and T9a–T9d,
// beside the producers it constrains.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dbAvailable, dbRequired } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { executionsRouter, toOutcomeSection } from './executions.js';
import { accuracyRouter } from './accuracy.js';

const DB_OK = await dbAvailable();

const WS       = '00000000-0000-4000-8000-00000000b4c0';
const OTHER_WS = '00000000-0000-4000-8000-00000000b4c1';
const ENTITY   = '00000000-0000-4000-8000-00000000b4ce';

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  app.use('/api/lumi', executionsRouter);
  app.use('/api/lumi', accuracyRouter);
  return app;
}
const get = (id, opts) => request(makeApp(opts)).get(`/api/lumi/decisions/${id}/executions`);

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B4-A lifecycle fixture',
    channel: 'META', objective: 'OUTCOME_SALES', status: 'PROPOSED', ...over,
  },
  select: { id: true, createdAt: true },
});

const makeExecution = (over = {}) => prisma.executionRequest.create({
  data: {
    workspaceId: WS, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
    actionType: 'PAUSE_CAMPAIGN', targetId: '23851234567', status: 'QUEUED', ...over,
  },
  select: { id: true },
});

const makeOutcome = (decisionId, over = {}) => prisma.outcomeSnapshot.create({
  data: {
    workspaceId: WS, decisionId, entityId: ENTITY, entityLevel: 'CAMPAIGN', ...over,
  },
  select: { id: true },
});

// NOT skippable — an absent database must not read as a passing contract.
describe('B4-A — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

// ── The pure projector, with no database in the way ─────────────────────────
describe('B4-A — toOutcomeSection states absence rather than shaping it', () => {
  it('T6a · no outcome carries `available: false` and NOTHING else', () => {
    const section = toOutcomeSection(null);
    expect(section).toEqual({ available: false });
    // Named individually as well: `toEqual` above would still pass if a future
    // edit replaced the whole object, and these are the specific fields whose
    // presence would make an absence read as a result.
    for (const key of ['outcomeId', 'measuredAt', 'recordedAt', 'window', 'sustained', 'deltas']) {
      expect(section, `absence must not carry ${key}`).not.toHaveProperty(key);
    }
  });

  it('T6b · an unmeasured delta stays null — never 0', () => {
    // A 0 delta is a real measurement: somebody looked and the number did not
    // move. `?? 0` on an unrecorded column would manufacture that finding.
    const section = toOutcomeSection({
      id: 'o1', measuredAt: null, createdAt: new Date('2026-08-01T00:00:00Z'),
      windowStart: null, windowEnd: null, sustained: null,
      spendDeltaMinor: null, revenueDeltaMinor: null, roasDelta: null,
    });
    expect(section.available).toBe(true);
    expect(section.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: null });
    expect(section.deltas.spendMinor).not.toBe(0);
    expect(section.deltas.revenueMinor).not.toBe(0);
    expect(section.deltas.roas).not.toBe(0);
  });

  it('T6c · an unestablished `sustained` stays null — never false', () => {
    // null = nobody checked whether the lift held. false = somebody checked and
    // it did not. Collapsing them turns an open question into a failed result.
    const section = toOutcomeSection({
      id: 'o1', measuredAt: null, createdAt: new Date(), windowStart: null, windowEnd: null,
      sustained: null, spendDeltaMinor: null, revenueDeltaMinor: null, roasDelta: null,
    });
    expect(section.sustained).toBeNull();
    expect(section.sustained).not.toBe(false);
  });

  it('T6d · a real false is preserved as false', () => {
    // The other direction of the same rule: honesty about absence must not cost
    // us the ability to report a genuine negative finding.
    const section = toOutcomeSection({
      id: 'o1', measuredAt: new Date(), createdAt: new Date(), windowStart: null, windowEnd: null,
      sustained: false, spendDeltaMinor: 0, revenueDeltaMinor: 0, roasDelta: 0,
    });
    expect(section.sustained).toBe(false);
    expect(section.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: 0 });
  });

  it('T6e · invents no `status` the model does not have', () => {
    // OutcomeSnapshot has no status column. A word here would be derived at
    // read time and then read back as though it had been recorded.
    const section = toOutcomeSection({
      id: 'o1', measuredAt: new Date(), createdAt: new Date(), windowStart: null, windowEnd: null,
      sustained: true, spendDeltaMinor: -5000, revenueDeltaMinor: null, roasDelta: null,
    });
    expect(section).not.toHaveProperty('status');
    expect(section).not.toHaveProperty('state');
    expect(section).not.toHaveProperty('verdict');
    expect(section).not.toHaveProperty('success');
  });

  it('measuredAt never falls back to recordedAt', () => {
    // Two different questions: when the result was ESTABLISHED, and when the row
    // was written. Rows recorded before R6 have only the second.
    const createdAt = new Date('2026-08-02T00:00:00Z');
    const section = toOutcomeSection({
      id: 'o1', measuredAt: null, createdAt, windowStart: null, windowEnd: null,
      sustained: null, spendDeltaMinor: null, revenueDeltaMinor: null, roasDelta: null,
    });
    expect(section.measuredAt).toBeNull();
    expect(section.recordedAt).toEqual(createdAt);
  });
});

describe.skipIf(!DB_OK)('B4-A — the lifecycle read path', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `B4A ${id.slice(-4)}` } });
    }
  });
  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });
  beforeEach(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    // Outcomes cascade from the decision, which is deleted next.
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  // ── T1 ────────────────────────────────────────────────────────────────────
  it('T1 · the decision reads back as itself', async () => {
    const d = await makeDecision();
    const res = await get(d.id);

    expect(res.status).toBe(200);
    expect(res.body.decisionId).toBe(d.id);
    expect(res.body.verdict).toBe('KILL');
    expect(res.body.decisionStatus).toBe('PROPOSED');
    // Real row values, not defaults invented at read time.
    expect(new Date(res.body.decisionCreatedAt).toISOString()).toBe(d.createdAt.toISOString());
  });

  // ── T2 ────────────────────────────────────────────────────────────────────
  it('T2 · a recorded human judgment reads back whole', async () => {
    const respondedAt = new Date('2026-08-03T10:00:00Z');
    const d = await makeDecision({
      humanResponse: 'OVERRIDE', humanReasonCode: 'SEASONALITY', humanRespondedAt: respondedAt,
    });
    const res = await get(d.id);

    expect(res.body.humanJudgment.response).toBe('OVERRIDE');
    expect(res.body.humanJudgment.reasonCode).toBe('SEASONALITY');
    expect(new Date(res.body.humanJudgment.respondedAt).toISOString()).toBe(respondedAt.toISOString());
  });

  it('T2b · no judgment reads as null, and never as a default opinion', async () => {
    // The absence of an opinion is not an opinion. A `?? "CONFIRM"` or a
    // `?? "OTHER"` here would put words in an operator's mouth.
    const d = await makeDecision();
    const res = await get(d.id);

    expect(res.body.humanJudgment.response).toBeNull();
    expect(res.body.humanJudgment.reasonCode).toBeNull();
    expect(res.body.humanJudgment.respondedAt).toBeNull();
  });

  // ── T3 ────────────────────────────────────────────────────────────────────
  it('T3 · no execution is a measured zero, and mints no placeholder', async () => {
    const d = await makeDecision();
    const res = await get(d.id);

    expect(res.body.executions).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.current).toBeNull();
    expect(res.body.execution.state).toBe('NONE');
    expect(res.body.platformExecution.executed).toBe(false);
  });

  // ── T4 ────────────────────────────────────────────────────────────────────
  it('T4 · an execution reads back with the row\'s own values', async () => {
    const d = await makeDecision();
    const e = await makeExecution({ decisionId: d.id, status: 'EXECUTED_SUCCESS' });
    const res = await get(d.id);

    expect(res.body.count).toBe(1);
    expect(res.body.current.executionId).toBe(e.id);
    expect(res.body.current.status).toBe('EXECUTED_SUCCESS');
    expect(res.body.current.actionType).toBe('PAUSE_CAMPAIGN');
    expect(res.body.current.targetId).toBe('23851234567');
  });

  // ── T5 — the one that matters most ────────────────────────────────────────
  it('T5 · a self-report never becomes a platform confirmation', async () => {
    const reportedAt = new Date('2026-08-04T09:00:00Z');
    const d = await makeDecision({ humanExecutedAt: reportedAt });
    const res = await get(d.id);

    // The operator's claim is reported AS a claim.
    expect(res.body.humanExecution.reported).toBe(true);
    expect(new Date(res.body.humanExecution.reportedAt).toISOString()).toBe(reportedAt.toISOString());

    // And Lumi executed nothing. This is the non-implication: a human saying
    // they acted is not evidence that any platform confirmed a mutation.
    expect(res.body.platformExecution.executed).toBe(false);
    expect(res.body.platformExecution.executedAt).toBeNull();
    // The execution summary is derived ONLY from ExecutionRequest rows, so a
    // self-report cannot move it either.
    expect(res.body.execution.state).toBe('NONE');
    expect(res.body.count).toBe(0);
  });

  it('T5b · and a platform execution is not reported as a self-report', async () => {
    // The converse, so the split cannot be satisfied by collapsing the other way.
    const executedAt = new Date('2026-08-04T11:00:00Z');
    const d = await makeDecision({ platformExecutedAt: executedAt });
    const res = await get(d.id);

    expect(res.body.platformExecution.executed).toBe(true);
    expect(res.body.humanExecution.reported).toBe(false);
    expect(res.body.humanExecution.reportedAt).toBeNull();
  });

  // ── T6 ────────────────────────────────────────────────────────────────────
  it('T6 · a decision with no outcome says so, and fabricates no metrics', async () => {
    const d = await makeDecision({ platformExecutedAt: new Date() });
    const res = await get(d.id);

    expect(res.body.outcome).toEqual({ available: false });
    // Executing something does not produce a result. The two axes are separate,
    // and an executed decision with no outcome is the NORMAL state.
    expect(res.body.platformExecution.executed).toBe(true);
  });

  // ── T7 ────────────────────────────────────────────────────────────────────
  it('T7 · outcome facts remain available while unproven money is withheld without changing storage', async () => {
    const measuredAt   = new Date('2026-08-10T00:00:00Z');
    const windowStart  = new Date('2026-08-01T00:00:00Z');
    const windowEnd    = new Date('2026-08-08T00:00:00Z');
    const d = await makeDecision({ humanExecutedAt: windowStart });
    const o = await makeOutcome(d.id, {
      measuredAt, windowStart, windowEnd, sustained: true,
      spendDeltaMinor: -5000, revenueDeltaMinor: 1200, roasDelta: 0.4,
    });

    const before = await prisma.outcomeSnapshot.findUnique({ where: { id: o.id } });
    const res = await get(d.id);

    expect(res.body.outcome.available).toBe(true);
    expect(res.body.outcome.outcomeId).toBe(o.id);
    expect(new Date(res.body.outcome.measuredAt).toISOString()).toBe(measuredAt.toISOString());
    expect(new Date(res.body.outcome.window.start).toISOString()).toBe(windowStart.toISOString());
    expect(new Date(res.body.outcome.window.end).toISOString()).toBe(windowEnd.toISOString());
    expect(res.body.outcome.sustained).toBe(true);
    expect(res.body.outcome.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: 0.4 });
    expect(res.body.outcome.monetary).toEqual({
      status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
      knowledge: 'NOT_ENOUGH', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null,
    });
    expect(JSON.stringify(res.body.outcome)).not.toContain('-5000');
    expect(JSON.stringify(res.body.outcome)).not.toContain('1200');
    expect(await prisma.outcomeSnapshot.findUnique({ where: { id: o.id } })).toEqual(before);
  });

  it('T7b · a superseded outcome is never the one returned', async () => {
    // Recording again APPENDS. The retired row keeps its values, and the
    // current-outcome definition (`supersededAt IS NULL`) is what separates
    // them — owned by outcomeSelection, not re-derived here as "the newest".
    const d = await makeDecision({ humanExecutedAt: new Date('2026-08-01T00:00:00Z') });
    const current = await makeOutcome(d.id, { measuredAt: new Date('2026-08-11T00:00:00Z'), roasDelta: 0.9 });
    const retired = await makeOutcome(d.id, { measuredAt: new Date('2026-08-10T00:00:00Z'), roasDelta: -0.5 });
    await prisma.outcomeSnapshot.update({
      where: { id: retired.id },
      data:  { supersededAt: new Date(), supersededById: current.id },
    });

    const res = await get(d.id);

    expect(res.body.outcome.outcomeId).toBe(current.id);
    expect(res.body.outcome.deltas.roas).toBe(0.9);
  });

  it.each([
    ['negative/positive', -7654321, 2345678, true],
    ['zero', 0, 0, false],
    ['null', null, null, null],
  ])('SC-11 · %s stored money never acquires authority from workspace currency', async (_label, spend, revenue, sustained) => {
    const d = await makeDecision({ humanExecutedAt: new Date('2026-08-01') });
    const o = await makeOutcome(d.id, {
      spendDeltaMinor: spend, revenueDeltaMinor: revenue, sustained, roasDelta: 0.7,
    });
    const before = await prisma.outcomeSnapshot.findUnique({ where: { id: o.id } });
    let first;
    for (const currency of ['EGP', 'JPY', 'USD']) {
      await prisma.workspace.update({ where: { id: WS }, data: { currency } });
      const res = await get(d.id);
      expect(res.status).toBe(200);
      expect(res.body.outcome.available).toBe(true);
      expect(res.body.outcome.monetary).toEqual({
        status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
        knowledge: 'NOT_ENOUGH', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null,
      });
      expect(res.body.outcome.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: 0.7 });
      expect(res.body.outcome.sustained).toBe(sustained);
      if (first) expect(res.body.outcome).toEqual(first);
      first = res.body.outcome;
      expect(await prisma.outcomeSnapshot.findUnique({ where: { id: o.id } })).toEqual(before);
    }
  });

  it('SC-11 · POST receipt and GET agree while the writer retains the original human-reported values', async () => {
    const d = await makeDecision({ humanExecutedAt: new Date('2026-08-01') });
    const body = {
      spendDeltaMinor: -654321, revenueDeltaMinor: 876543, roasDelta: -0.3,
      windowStart: '2026-08-02T00:00:00Z', windowEnd: '2026-08-09T00:00:00Z',
      measuredAt: '2026-08-10T00:00:00Z', sustained: false,
      // Caller-supplied authority must not survive the writer/projection.
      currency: 'USD', monetary: { status: 'AVAILABLE', currency: 'USD' },
    };
    const post = await request(makeApp()).post(`/api/lumi/decisions/${d.id}/outcome`).send(body);
    expect(post.status).toBe(201);
    expect(post.body.outcome).toMatchObject({
      decisionId: d.id, workspaceId: WS, sustained: false, roasDelta: -0.3,
      spendDeltaMinor: null, revenueDeltaMinor: null, currency: null,
      monetary: { status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN' },
    });
    expect(JSON.stringify(post.body)).not.toContain('654321');
    expect(JSON.stringify(post.body)).not.toContain('876543');
    const stored = await prisma.outcomeSnapshot.findUnique({ where: { id: post.body.outcome.id } });
    expect(stored).toMatchObject({
      spendDeltaMinor: body.spendDeltaMinor, revenueDeltaMinor: body.revenueDeltaMinor,
      roasDelta: body.roasDelta, sustained: false,
    });
    const res = await get(d.id);
    expect(res.status).toBe(200);
    expect(res.body.outcome.monetary).toEqual(post.body.outcome.monetary);
    expect(res.body.outcome.outcomeId).toBe(stored.id);
    expect(res.body.outcome.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: -0.3 });
    expect(await prisma.outcomeSnapshot.findUnique({ where: { id: stored.id } })).toEqual(stored);
  });

  it('T7c · an outcome with nothing measured is available but empty-handed', async () => {
    // A row can exist with every metric null — recorded before R6, or recorded
    // by someone who established the window but not the numbers. It is present
    // AND it measured nothing, and both halves have to survive the wire.
    const d = await makeDecision({ humanExecutedAt: new Date() });
    await makeOutcome(d.id, {});

    const res = await get(d.id);

    expect(res.body.outcome.available).toBe(true);
    expect(res.body.outcome.measuredAt).toBeNull();
    expect(res.body.outcome.sustained).toBeNull();
    expect(res.body.outcome.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: null });
  });

  it('an outcome does not imply an execution', async () => {
    // Recorded against a decision the operator acted on by hand: a real result,
    // and Lumi executed nothing. The read path must report both truthfully in
    // the same response rather than letting one colour the other.
    const d = await makeDecision({ humanExecutedAt: new Date('2026-08-01T00:00:00Z') });
    await makeOutcome(d.id, { measuredAt: new Date('2026-08-09T00:00:00Z'), sustained: true });

    const res = await get(d.id);

    expect(res.body.outcome.available).toBe(true);
    expect(res.body.platformExecution.executed).toBe(false);
    expect(res.body.execution.state).toBe('NONE');
    expect(res.body.count).toBe(0);
  });

  // ── T8 ────────────────────────────────────────────────────────────────────
  it('T8 · another workspace\'s decision is a 404, outcome and all', async () => {
    const foreign = await prisma.decision.create({
      data: {
        workspaceId: OTHER_WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
        verdict: 'KILL', confidence: 0.8, diagnosis: 'foreign',
        humanExecutedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.outcomeSnapshot.create({
      data: {
        workspaceId: OTHER_WS, decisionId: foreign.id, entityId: ENTITY,
        entityLevel: 'CAMPAIGN', roasDelta: 9.9,
      },
    });

    const res = await get(foreign.id);

    expect(res.status).toBe(404);
    // Nothing about the foreign row leaks through the refusal.
    expect(JSON.stringify(res.body)).not.toContain('9.9');
    expect(res.body).not.toHaveProperty('outcome');
  });

  it('T8b · an outcome belonging to another workspace never joins the read', async () => {
    // The decision is ours; a row pointing at it from another tenant is not.
    // The FK targets `decisions.id` alone and carries no tenant component, so
    // the database permits this and the application has to refuse it.
    const d = await makeDecision({ humanExecutedAt: new Date() });
    await prisma.outcomeSnapshot.create({
      data: {
        workspaceId: OTHER_WS, decisionId: d.id, entityId: ENTITY,
        entityLevel: 'CAMPAIGN', roasDelta: 9.9,
      },
    });

    const res = await get(d.id);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toEqual({ available: false });
  });
});
