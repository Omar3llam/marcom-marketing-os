// ============================================================
// T12-A — the self-report response reports the DECISION, not the request
// ============================================================
// `signalBody` publishes two independent provenance facts. Before this slice it
// published one and asserted the other:
//
//   platformExecution: null            ← unconditional
//
// For a decision Lumi had already executed, that is a true row denied on the
// wire — the response says "we looked, and Lumi has not executed this" about a
// `platformExecutedAt` that is set. The governing rule is that every fact on
// screen traces to a real row; here the row existed and the projection erased it.
//
// ── Why some of this is not an HTTP test ─────────────────────────────────────
// PATCH /decisions/:id/execute always writes `humanExecutedAt`, so two of the
// four provenance states can never appear in a response it sends: human-null.
// A contract that only holds for the states HTTP can reach is not the contract —
// the projection is therefore driven directly for those, from rows that were
// really persisted and really read back, so the values under test come out of
// Postgres rather than out of a literal.
//
// The two reachable states are driven over HTTP, once per keying, because the
// by-id and by-entity paths each own their own `select` and a column dropped
// from either one silently reinstates the bug on that path alone.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');
const { decisionsRouter, signalBody } = await import('./decisions.js');

const DB_OK = await dbAvailable();

const WS     = '00000000-0000-4000-8000-0000000012a0';
const ENTITY = '00000000-0000-4000-8000-0000000012a1';

const HUMAN    = new Date('2026-07-01T00:00:00.000Z');
const PLATFORM = new Date('2026-08-01T00:00:00.000Z');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.workspaceId = WS; req.collabRole = 'BUYER';
    req.userId = 'user-t12a'; req.userRole = 'MEMBER';
    next();
  });
  a.use('/api/lumi', decisionsRouter);
  return a;
}

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'T12-A fixture',
    channel: 'META', objective: 'OUTCOME_SALES', status: 'PROPOSED', ...over,
  },
  select: { id: true },
});

// The row as the route reads it, then through the projection under test. Both
// halves come from the database; nothing here is a hand-written timestamp.
async function project(id) {
  const row = await prisma.decision.findUnique({
    where:  { id },
    select: { humanExecutedAt: true, platformExecutedAt: true },
  });
  return signalBody('humanExecutedAt', row.humanExecutedAt, row.platformExecutedAt);
}

describe('T12-A — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('T12-A — truthful platform execution projection', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'T12A' } });
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
  });

  // ── T1 · human only ───────────────────────────────────────────────────────
  it('T1 · a self-reported decision reports a human execution and no platform one', async () => {
    const d = await makeDecision({ humanExecutedAt: HUMAN });
    const body = await project(d.id);

    expect(body.humanExecution).toEqual({ reported: true, reportedAt: HUMAN });
    // Absence, stated. This is the case the old unconditional null got right —
    // and the only one.
    expect(body.platformExecution).toBeNull();
  });

  // ── T2 · platform only — the bug reproduction ─────────────────────────────
  it('T2 · a decision LUMI executed reports it, even with no human claim', async () => {
    // Before T12-A this returned `platformExecution: null` — a response that
    // denies a fact the row asserts. It is the whole reason for the slice, and
    // it is unreachable over HTTP on this route, which is why it went unnoticed.
    const d = await makeDecision({ platformExecutedAt: PLATFORM });
    const body = await project(d.id);

    expect(body.platformExecution).toEqual({ executed: true, executedAt: PLATFORM });
    // …and no human claim is invented to go with it. An execution Lumi performed
    // on its own is not evidence the operator reported anything.
    expect(body.humanExecution).toBeNull();
  });

  // ── T3 · both, independently ──────────────────────────────────────────────
  it('T3 · both facts coexist and neither borrows the other’s timestamp', async () => {
    const d = await makeDecision({ humanExecutedAt: HUMAN, platformExecutedAt: PLATFORM });
    const body = await project(d.id);

    expect(body.humanExecution.reportedAt).toEqual(HUMAN);
    expect(body.platformExecution.executedAt).toEqual(PLATFORM);
    // Stated as an inequality too: the two fixtures are deliberately different
    // instants, so any substitution between the columns is a failure and not a
    // coincidence that happens to still pass.
    expect(body.humanExecution.reportedAt).not.toEqual(body.platformExecution.executedAt);
    // The deprecated alias tracks the HUMAN side here, not the union.
    expect(body.executedAt).toEqual(HUMAN);
  });

  // ── T4 · neither ──────────────────────────────────────────────────────────
  it('T4 · an untouched decision reports neither execution', async () => {
    const d = await makeDecision();
    const body = await project(d.id);

    expect(body.humanExecution).toBeNull();
    expect(body.platformExecution).toBeNull();
    // Not `createdAt`, and not an empty object: nothing happened, and the
    // response says so rather than reaching for the nearest available date.
    expect(body.executedAt).toBeNull();
  });

  // ── T5 · the whole thing, end to end, on the discriminating state ─────────
  // The tests above drive the projection directly. These two drive it over HTTP,
  // once per keying, because the by-id and by-entity paths each own their own
  // `select`: drop `platformExecutedAt` from either query and
  // `decision.platformExecutedAt` is `undefined`, the projection falls to null,
  // and that path alone starts denying the execution again — invisibly to a
  // projection test and to the other path's HTTP test.
  it('T5 · a self-report over an existing Lumi execution keeps BOTH facts apart', async () => {
    // The test that stops the fix from "solving" the bug by collapsing. Making
    // `platformExecution` truthful is easy to get wrong in the direction that
    // loses the distinction — derive the alias from the union, or let one object
    // read the other's column, and every claim that "Lumi executed this" becomes
    // satisfiable by an operator typing a claim.
    //
    // Same discriminating fixture as T11-T4 in routes/execution/
    // provenance.contract.test.js: already platform-executed, so the human and
    // platform instants are different values and any substitution is visible.
    const d = await makeDecision({ platformExecutedAt: PLATFORM });
    const { status, body } = await request(app()).patch(`/api/lumi/decisions/${d.id}/execute`).send({});

    expect(status).toBe(200);
    expect(body.recorded).toBe(true);

    // 1. The deprecated alias stays HUMAN — unchanged by T12-A.
    expect(body.executedAt).toBe(body.humanExecutedAt);
    expect(new Date(body.executedAt).getTime()).not.toBe(PLATFORM.getTime());

    // 2. Lumi's execution is REPORTED rather than denied — the defect itself.
    expect(body.platformExecution).toEqual({ executed: true, executedAt: PLATFORM.toISOString() });

    // 3. The human claim keeps its own instant, not Lumi's.
    expect(body.humanExecution.reported).toBe(true);
    expect(body.humanExecution.reportedAt).toBe(body.humanExecutedAt);
    expect(body.humanExecution.reportedAt).not.toBe(body.platformExecution.executedAt);

    // 4. Nothing was collapsed in storage either.
    const row = await prisma.decision.findUnique({
      where: { id: d.id }, select: { humanExecutedAt: true, platformExecutedAt: true },
    });
    expect(row.platformExecutedAt).toEqual(PLATFORM);
    expect(row.humanExecutedAt).toBeTruthy();
    expect(row.humanExecutedAt).not.toEqual(PLATFORM);
  });

  it('by-entity · the fallback keying carries it too', async () => {
    await makeDecision({ platformExecutedAt: PLATFORM });
    const { status, body } = await request(app())
      .patch(`/api/lumi/decisions/by-entity/${ENTITY}/execute`).send({});

    expect(status).toBe(200);
    expect(body.platformExecution).toEqual({ executed: true, executedAt: PLATFORM.toISOString() });
    expect(body.executedAt).toBe(body.humanExecutedAt);
  });

  // ── The idempotent replay reports the same two facts ──────────────────────
  it('a repeated self-report still reports Lumi’s execution', async () => {
    // The `recorded: false` branch is a second call site for the projection.
    // It reads the ORIGINAL human instant, and it has to pass the platform
    // column through as well — otherwise the first response tells the truth and
    // the replay of the same request denies it.
    const d = await makeDecision({ humanExecutedAt: HUMAN, platformExecutedAt: PLATFORM });
    const { status, body } = await request(app()).patch(`/api/lumi/decisions/${d.id}/execute`).send({});

    expect(status).toBe(200);
    expect(body.recorded).toBe(false);
    expect(body.humanExecution.reportedAt).toBe(HUMAN.toISOString());
    expect(body.platformExecution).toEqual({ executed: true, executedAt: PLATFORM.toISOString() });
  });

  // ── The dismiss signal is not an execution response ───────────────────────
  it('the dismiss signal publishes neither execution object', async () => {
    // `signalBody` serves all four signals. Only the execute one answers the
    // provenance question, and widening the others into it would put an
    // execution report on a response that recorded a refusal to execute.
    const d = await makeDecision({ platformExecutedAt: PLATFORM });
    const { status, body } = await request(app()).patch(`/api/lumi/decisions/${d.id}/dismiss`).send({});

    expect(status).toBe(200);
    expect(body).not.toHaveProperty('platformExecution');
    expect(body).not.toHaveProperty('humanExecution');
    expect(body).not.toHaveProperty('executedAt');
  });
});
