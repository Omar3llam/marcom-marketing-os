// ============================================================
// R13-D / B3 — Decision → ExecutionRequest, against a real database
// ============================================================
// Discovery found this relationship carrying an FK and a dedicated index while
// being projected by zero routes, and every test that touched it mocking
// Prisma. A mock agrees with whatever the code asks it for, so none of the
// claims below — the FK, SET NULL, the tenant boundary, one-to-many lineage —
// could fail against one.
//
// Everything here runs on the real generated client, the real migrated schema
// and the real role gate.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { executionsRouter } from './executions.js';

const DB_OK = await dbAvailable();

const WS       = '00000000-0000-4000-8000-00000000b300';
const OTHER_WS = '00000000-0000-4000-8000-00000000b301';
const ENTITY   = '00000000-0000-4000-8000-00000000b3e1';

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  app.use('/api/lumi', executionsRouter); // flat-mounted, exactly as lumi/index.js does
  return app;
}
const get = (id, opts) => request(makeApp(opts)).get(`/api/lumi/decisions/${id}/executions`);

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B3 fixture',
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

// NOT skippable — an absent database must not read as a passing contract.
describe('B3 — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B3 — the execution read path', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `B3 ${id.slice(-4)}` } });
    }
  });
  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });
  beforeEach(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  // ── The relationship is real ───────────────────────────────────────────────
  it('1. a decision reads back the execution that carries it out', async () => {
    const d = await makeDecision();
    const e = await makeExecution({ decisionId: d.id });

    const res = await get(d.id);
    expect(res.status).toBe(200);
    expect(res.body.decisionId).toBe(d.id);
    expect(res.body.count).toBe(1);
    expect(res.body.current.executionId).toBe(e.id);
    expect(res.body.current.decisionId).toBe(d.id);
    expect(res.body.current.status).toBe('QUEUED');
    expect(res.body.current.actionType).toBe('PAUSE_CAMPAIGN');
    expect(res.body.current.targetId).toBe('23851234567');
  });

  it('2. a decision with no execution reports an established zero, not a failure', async () => {
    const d = await makeDecision();
    const res = await get(d.id);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.executions).toEqual([]);
    expect(res.body.current).toBeNull();
    // …and the self-report axis is visible beside it, which is what lets a
    // reader tell "Lumi executed this" from "the operator says they did".
    expect(res.body.executedAt).toBeNull();
  });

  it('3. a self-reported decision has executedAt but NO executions', async () => {
    // The distinction B3 exists to make readable. Same column, different story.
    const d = await makeDecision({ executedAt: new Date('2026-08-19T10:00:00Z') });
    const res = await get(d.id);
    expect(res.body.count).toBe(0);
    expect(new Date(res.body.executedAt)).toEqual(new Date('2026-08-19T10:00:00Z'));
  });

  // ── Tenant boundary, from both sides ───────────────────────────────────────
  it('4. another workspace\'s decision is a 404, not a 403', async () => {
    const d = await makeDecision({ workspaceId: OTHER_WS });
    const res = await get(d.id);
    expect(res.status).toBe(404);
    // The same answer a non-existent id gets, so the response cannot be used to
    // discover which ids are real.
    expect((await get('00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
  });

  it('5. an execution row belonging to another workspace never joins the list', async () => {
    // The FK targets decisions.id alone and carries no tenant component, so the
    // database would permit this row. The route's second predicate is what
    // refuses it — and this is the test that proves the predicate is real.
    const d = await makeDecision();
    await makeExecution({ decisionId: d.id, workspaceId: WS, targetId: '111' });
    await prisma.executionRequest.create({
      data: {
        workspaceId: OTHER_WS, idempotencyKey: 'cross-tenant',
        actionType: 'PAUSE_CAMPAIGN', targetId: '999', status: 'QUEUED', decisionId: d.id,
      },
    });

    const res = await get(d.id);
    expect(res.body.count).toBe(1);
    expect(res.body.current.targetId).toBe('111');
  });

  it('6. the database itself permits the cross-tenant row — application-enforced, and now proven so', () => {
    // Stated as a finding rather than assumed. Test 5 created that row
    // successfully; if a future migration adds a composite FK, test 5 will fail
    // at the create and this comment is where to look.
    expect(true).toBe(true);
  });

  // ── One-to-many, with lineage ──────────────────────────────────────────────
  it('7. one decision may own several executions, newest first', async () => {
    const d = await makeDecision();
    const first = await makeExecution({ decisionId: d.id, status: 'EXECUTED_FAILED', targetId: '1' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await makeExecution({ decisionId: d.id, status: 'QUEUED', targetId: '2' });

    const res = await get(d.id);
    expect(res.body.count).toBe(2);
    expect(res.body.current.executionId).toBe(second.id);
    expect(res.body.executions.map((e) => e.executionId)).toEqual([second.id, first.id]);
  });

  it('8. a retry is distinguishable from a separate execution', async () => {
    const d = await makeDecision();
    const original = await makeExecution({ decisionId: d.id, status: 'EXECUTED_FAILED' });
    await new Promise((r) => setTimeout(r, 5));
    await makeExecution({
      decisionId: d.id, status: 'QUEUED',
      retryMetadata: { retryOf: original.id, retriedAt: new Date().toISOString(), retryDepth: 1 },
    });

    const res = await get(d.id);
    const [retry, first] = res.body.executions;
    expect(retry.retryOf).toBe(original.id);
    expect(retry.retryDepth).toBe(1);
    // An original carries no lineage — that is what makes the pair readable as
    // "one attempt, once retried" rather than two independent executions.
    expect(first.retryOf).toBeNull();
    expect(first.retryDepth).toBe(0);
  });

  it('9. terminal states are flagged, and QUEUED is not one of them', async () => {
    const d = await makeDecision();
    await makeExecution({ decisionId: d.id, status: 'QUEUED' });
    expect((await get(d.id)).body.current.terminal).toBe(false);

    await prisma.executionRequest.updateMany({
      where: { decisionId: d.id }, data: { status: 'EXECUTED_SUCCESS' },
    });
    expect((await get(d.id)).body.current.terminal).toBe(true);
  });

  // ── Nothing fabricated ─────────────────────────────────────────────────────
  it('10. never invents an executedAt on the execution row', async () => {
    // ExecutionRequest has no executedAt column. `lastTransitionAt` is
    // updatedAt, named for what it is — publishing it as executedAt would
    // assert a completion that a QUEUED row has not reached.
    const d = await makeDecision();
    await makeExecution({ decisionId: d.id, status: 'QUEUED' });
    const row = (await get(d.id)).body.current;
    expect(row).not.toHaveProperty('executedAt');
    expect(row).toHaveProperty('lastTransitionAt');
    // …and no fabricated provider label: the model has no such column.
    expect(row).not.toHaveProperty('provider');
  });

  it('11. does not leak the request payload or the raw platform response', async () => {
    const d = await makeDecision();
    await makeExecution({
      decisionId: d.id,
      payload: { secret: 'do-not-publish' },
      response: { token: 'do-not-publish' },
    });
    expect(JSON.stringify((await get(d.id)).body)).not.toMatch(/do-not-publish/);
  });

  // ── FK behaviour ───────────────────────────────────────────────────────────
  it('12. deleting a Decision nulls the link and KEEPS the execution audit row', async () => {
    // SET NULL, not Cascade: a mutation that really happened on the ad platform
    // must not disappear because the call behind it was deleted.
    const d = await makeDecision();
    const e = await makeExecution({ decisionId: d.id });
    await prisma.decision.delete({ where: { id: d.id } });

    const still = await prisma.executionRequest.findUnique({
      where: { id: e.id }, select: { id: true, decisionId: true },
    });
    expect(still).not.toBeNull();
    expect(still.decisionId).toBeNull();
  });

  // ── Authorization ──────────────────────────────────────────────────────────
  it('13. a CLIENT cannot read the execution log', async () => {
    const d = await makeDecision();
    await makeExecution({ decisionId: d.id });
    const res = await get(d.id, { collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/PAUSE_CAMPAIGN|23851234567/);
  });

  it('14. a STRATEGIST can', async () => {
    const d = await makeDecision();
    expect((await get(d.id, { collabRole: 'STRATEGIST' })).status).toBe(200);
  });
});
