// ============================================================
// Human judgment contract (R13)
// ============================================================
// Lumi's verdict and the operator's judgement of it are two independent facts,
// and this suite exists to keep them that way. If Lumi says KILL and the buyer
// says KEEP, the row must end up carrying BOTH — verdict=KILL, and
// humanResponse=OVERRIDE. Rewriting the verdict would destroy the only evidence
// a disagreement ever happened, which is exactly what R14 needs to learn from.
//
// Everything here runs against the REAL generated client and the REAL migrated
// database, through the REAL role gate. R12-1d was a five-week outage that
// survived only because every test touching that model mocked prisma: a mock
// cannot fail the way a schema does. So nothing here mocks the database, and
// nothing here mocks authorization.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dbAvailable, dbRequired } from '../tests/dbProbe.js';
import { prisma } from '../lib/prisma.js';
import { decisionsRouter } from '../routes/lumi/decisions.js';
import { getSimilarOutcomes } from '../services/analysis/decisionLearning.js';

const DB_OK = await dbAvailable();

const WS = '00000000-0000-4000-8000-0000000a1300';
const OTHER_WS = '00000000-0000-4000-8000-0000000a1301';
const ENTITY = '00000000-0000-4000-8000-0000000a13e1';

// The real gate reads req.collabRole directly (resolveCollabRole), so the
// authorization path under test is production's, not a stand-in.
function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  app.use('/api/lumi', decisionsRouter);   // flat-mounted, exactly as lumi/index.js does
  return app;
}

const judge = (id, body, opts) =>
  request(makeApp(opts)).patch(`/api/lumi/decisions/${id}/judgment`).send(body);

async function makeDecision(over = {}) {
  return prisma.decision.create({
    data: {
      workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
      verdict: 'KILL', confidence: 0.8, diagnosis: 'R13 fixture',
      rootCause: 'EFFICIENCY', channel: 'META', objective: 'SALES',
      decisionClass: 'SIGNAL', // C-10 — the learning projection is SIGNAL-scoped
      ...over,
    },
    select: { id: true, verdict: true, status: true },
  });
}

// NOT skippable. `describe.skipIf` makes an absent database look like a passing
// suite — the exact shape that let R12-1d hide for five weeks — so CI is
// required to have provided one. Locally the block may skip; in CI it may not.
describe('R13 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database, so the contract below is not vacuous', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('R13 — schema', () => {
  it('1. the four judgment fields exist, nullable, with no default', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name::text AS col, udt_name::text AS udt, is_nullable::text AS nullable,
             coalesce(column_default, '') AS def
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'decisions'`;
    const want = {
      humanResponse: 'HumanDecisionResponse', humanReasonCode: 'HumanDecisionReason',
      humanReasonNote: 'text', humanRespondedAt: 'timestamp',
    };
    for (const [col, udt] of Object.entries(want)) {
      const found = rows.find((r) => r.col === col);
      expect(found, `${col} is missing`).toBeDefined();
      expect(found.udt).toBe(udt);
      // Nullable forever: null means NO JUDGEMENT, and a default would forge one.
      expect(found.nullable, `${col} must stay nullable`).toBe('YES');
      expect(found.def, `${col} must have no default`).toBe('');
    }
  });

  it('2. both enums carry exactly the canonical labels, in order', async () => {
    const rows = await prisma.$queryRaw`
      SELECT t.typname::text AS type, e.enumlabel::text AS label
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e      ON e.enumtypid = t.oid
       WHERE n.nspname = 'public'
       ORDER BY t.typname, e.enumsortorder`;
    const labels = (t) => rows.filter((r) => r.type === t).map((r) => r.label);
    expect(labels('HumanDecisionResponse')).toEqual(['CONFIRM', 'OVERRIDE', 'ADJUST']);
    expect(labels('HumanDecisionReason')).toEqual([
      'OBJECTIVE_CONTEXT', 'BUSINESS_CONSTRAINT', 'TOF_ROLE', 'BRAND_ROLE',
      'SEASONALITY', 'DATA_CONTEXT', 'TESTING_INTENT', 'RISK_TOLERANCE', 'OTHER',
    ]);
  });

  it('3. the existing Decision lifecycle columns are untouched', async () => {
    const rows = await prisma.$queryRaw`
      SELECT column_name::text AS col FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'decisions'`;
    const cols = rows.map((r) => r.col);
    for (const c of ['verdict', 'status', 'executedAt', 'dismissedAt', 'resolvedAt',
      'resolution', 'intentAt', 'explainedAt', 'rootCause', 'entityLevel', 'objective', 'channel']) {
      expect(cols, `${c} disappeared`).toContain(c);
    }
  });
});

describe.skipIf(!DB_OK)('R13 — recording judgment', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER_WS]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `R13 ${id.slice(-4)}` } });
    }
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });

  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  it('4. CONFIRM persists, with no reason required', async () => {
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'CONFIRM' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, recorded: true, humanResponse: 'CONFIRM' });

    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBe('CONFIRM');
    expect(row.humanReasonCode).toBeNull();
    expect(row.humanRespondedAt).toBeInstanceOf(Date);
  });

  it('5. OVERRIDE + reason persists — and the verdict is NOT rewritten', async () => {
    // The whole product principle in one assertion. Lumi said KILL; the buyer
    // disagreed; both facts survive. A judgment that edited `verdict` would
    // erase the disagreement it was recorded to capture.
    const d = await makeDecision({ verdict: 'KILL' });
    const res = await judge(d.id, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' });

    expect(res.status).toBe(200);
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBe('OVERRIDE');
    expect(row.humanReasonCode).toBe('TOF_ROLE');
    expect(row.verdict, 'the verdict must never be rewritten').toBe('KILL');
  });

  it('6. ADJUST + reason persists', async () => {
    const d = await makeDecision({ verdict: 'SCALE' });
    const res = await judge(d.id, { response: 'ADJUST', reasonCode: 'RISK_TOLERANCE' });

    expect(res.status).toBe(200);
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBe('ADJUST');
    expect(row.verdict).toBe('SCALE');
  });

  it('7. the optional note persists verbatim', async () => {
    const NOTE = 'Increase only 10% because budget pacing is tight.';
    const d = await makeDecision();
    await judge(d.id, { response: 'ADJUST', reasonCode: 'BUSINESS_CONSTRAINT', reasonNote: NOTE });

    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanReasonNote).toBe(NOTE);
  });

  it('8. an unjudged decision keeps all four fields null — never CONFIRM, never OTHER', async () => {
    const d = await makeDecision();
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBeNull();
    expect(row.humanReasonCode).toBeNull();
    expect(row.humanReasonNote).toBeNull();
    expect(row.humanRespondedAt).toBeNull();
  });

  it('8b. a blank note is stored as null, not as an empty string', async () => {
    const d = await makeDecision();
    await judge(d.id, { response: 'CONFIRM', reasonNote: '   ' });
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanReasonNote).toBeNull();
  });

  // ── Validation ─────────────────────────────────────────────────────────
  it('9. OVERRIDE without a reason is refused, and writes nothing', async () => {
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'OVERRIDE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ReasonRequired');
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBeNull();
  });

  it('10. ADJUST without a reason is refused', async () => {
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'ADJUST' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ReasonRequired');
  });

  it('11. an unknown response is refused', async () => {
    const d = await makeDecision();
    for (const bad of ['REJECT', 'confirm', '', null, 42]) {
      const res = await judge(d.id, { response: bad });
      expect(res.status, `accepted ${JSON.stringify(bad)}`).toBe(400);
      expect(res.body.error).toBe('InvalidResponse');
    }
  });

  it('12. an unknown reason is refused', async () => {
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'OVERRIDE', reasonCode: 'BECAUSE_I_SAID_SO' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('InvalidReason');
  });

  it('13. a decision in ANOTHER workspace is invisible, not writable', async () => {
    // The lookup is id + workspaceId. Without the workspace predicate this
    // would write one account's reasoning onto another account's decision.
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'CONFIRM' }, { workspaceId: OTHER_WS });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DecisionNotFound');
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBeNull();
  });

  it('14. a non-PROPOSED decision cannot be judged', async () => {
    const d = await makeDecision();
    await prisma.decision.update({ where: { id: d.id }, data: { status: 'SUPERSEDED' } });

    const res = await judge(d.id, { response: 'CONFIRM' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DecisionNotActionable');
    expect(res.body.status).toBe('SUPERSEDED');
  });

  it('14b. a CLIENT seat cannot record judgment', async () => {
    const d = await makeDecision();
    const res = await judge(d.id, { response: 'CONFIRM' }, { collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBeNull();
  });

  // ── Idempotency ────────────────────────────────────────────────────────
  it('15 + 16. an identical repeat writes once and keeps the ORIGINAL timestamp', async () => {
    const body = { response: 'OVERRIDE', reasonCode: 'TOF_ROLE', reasonNote: 'kept for TOF' };
    const d = await makeDecision();

    const first = await judge(d.id, body);
    expect(first.body).toMatchObject({ recorded: true });
    const firstAt = (await prisma.decision.findUnique({ where: { id: d.id } })).humanRespondedAt;

    await new Promise((r) => setTimeout(r, 5));   // guarantee a distinguishable clock
    const second = await judge(d.id, body);

    expect(second.status).toBe(200);
    expect(second.body.recorded, 'a double-clicked button is one judgement').toBe(false);
    expect(new Date(second.body.humanRespondedAt).getTime()).toBe(firstAt.getTime());

    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanRespondedAt.getTime(), 'the timestamp must not be re-stamped').toBe(firstAt.getTime());
  });

  // ── Conflict ───────────────────────────────────────────────────────────
  it('17 + 18. a DIFFERENT second judgment is refused and changes nothing', async () => {
    const d = await makeDecision();
    await judge(d.id, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' });
    const before = await prisma.decision.findUnique({ where: { id: d.id } });

    const res = await judge(d.id, { response: 'CONFIRM' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('JudgmentAlreadyRecorded');

    const after = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(after.humanResponse).toBe('OVERRIDE');
    expect(after.humanReasonCode).toBe('TOF_ROLE');
    expect(after.humanRespondedAt.getTime()).toBe(before.humanRespondedAt.getTime());
  });

  it('17b. changing only the NOTE is also a different judgment', async () => {
    // The comparison is the whole triple. A note is part of the record, so
    // editing it after the fact is a rewrite like any other.
    const d = await makeDecision();
    await judge(d.id, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE', reasonNote: 'first' });
    const res = await judge(d.id, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE', reasonNote: 'second' });

    expect(res.status).toBe(409);
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanReasonNote).toBe('first');
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  it('19. judgment then execute both land, on independent axes', async () => {
    const d = await makeDecision();
    await judge(d.id, { response: 'CONFIRM' });
    const res = await request(makeApp()).patch(`/api/lumi/decisions/${d.id}/execute`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, recorded: true });
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBe('CONFIRM');
    // B4-A — the self-report route writes the HUMAN axis. A third axis, and it
    // must not touch the platform one: agreeing with a verdict and saying you
    // acted on it are both claims by the operator, and neither is evidence Lumi
    // executed anything.
    expect(row.humanExecutedAt).toBeInstanceOf(Date);
    expect(row.platformExecutedAt).toBeNull();
  });

  it('20. judgment then dismiss both land', async () => {
    const d = await makeDecision();
    await judge(d.id, { response: 'OVERRIDE', reasonCode: 'SEASONALITY' });
    const res = await request(makeApp()).patch(`/api/lumi/decisions/${d.id}/dismiss`).send({});

    expect(res.status).toBe(200);
    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.humanResponse).toBe('OVERRIDE');
    expect(row.dismissedAt).toBeInstanceOf(Date);
  });

  it('21. execute/dismiss keep their own first-write-wins contract', async () => {
    const d = await makeDecision();
    const first = await request(makeApp()).patch(`/api/lumi/decisions/${d.id}/execute`).send({});
    const again = await request(makeApp()).patch(`/api/lumi/decisions/${d.id}/execute`).send({});
    const opposite = await request(makeApp()).patch(`/api/lumi/decisions/${d.id}/dismiss`).send({});

    expect(first.body.recorded).toBe(true);
    expect(again.body.recorded).toBe(false);
    expect(opposite.status).toBe(409);
    expect(opposite.body.error).toBe('AlreadyExecuted');
  });

  it('22. an OVERRIDE alone leaves the decision PROPOSED and untouched by lifecycle', async () => {
    // OVERRIDE is not dismissal. A buyer who overrides a KILL and keeps
    // spending took no platform action, and the record says exactly that.
    // Reconciling this with the accuracy surface is R14's problem, and
    // inferring dismissedAt here would fabricate a signal nobody sent.
    const d = await makeDecision({ verdict: 'KILL' });
    await judge(d.id, { response: 'OVERRIDE', reasonCode: 'TOF_ROLE' });

    const row = await prisma.decision.findUnique({ where: { id: d.id } });
    expect(row.status).toBe('PROPOSED');
    expect(row.executedAt).toBeNull();
    expect(row.dismissedAt).toBeNull();
    expect(row.verdict).toBe('KILL');
  });
});

// ============================================================
// Learning can DISTINGUISH the human response — without grading it
// ============================================================
describe.skipIf(!DB_OK)('R13 — learning projection', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'R13 learning' } });
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });

    // Four comparable, SCORED, acted-on decisions — above MIN_SAMPLE (3).
    //
    // C1 — "acted on" is `humanExecutedAt`, the operator's report that they
    // performed the intervention. These rows used to carry `intentAt` instead,
    // which is what the learning query gated on before the evidence contract
    // was corrected — copying a recommendation is not changing a campaign, and
    // a fixture that still qualified on intent would keep passing against the
    // defect this suite's sibling exists to catch.
    const rows = [
      { resolution: 'IMPROVED', humanResponse: 'CONFIRM', humanReasonCode: null },
      { resolution: 'IMPROVED', humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE' },
      { resolution: 'WORSENED', humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE' },
      { resolution: 'UNCHANGED', humanResponse: null, humanReasonCode: null },
    ];
    for (const r of rows) {
      await prisma.decision.create({ data: {
        workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN', verdict: 'KILL',
        confidence: 0.8, diagnosis: 'R13 learning fixture', rootCause: 'EFFICIENCY',
        channel: 'META', objective: 'SALES', humanExecutedAt: new Date(),
        // C-10 — the learning projection is SIGNAL-scoped.
        decisionClass: 'SIGNAL',
        humanRespondedAt: r.humanResponse ? new Date() : null, ...r,
      } });
    }
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('splits comparable outcomes by human response, counting real rows only', async () => {
    const out = await getSimilarOutcomes({
      workspaceId: WS, verdict: 'KILL', rootCause: 'EFFICIENCY',
      entityLevel: 'CAMPAIGN', objective: 'SALES', channel: 'META',
    });

    expect(out).not.toBeNull();
    expect(out.total).toBe(4);
    expect(out.byHumanResponse.CONFIRM).toEqual({ total: 1, improved: 1, unchanged: 0, worsened: 0 });
    expect(out.byHumanResponse.OVERRIDE).toEqual({ total: 2, improved: 1, unchanged: 0, worsened: 1 });
    // Decisions with no judgement are their own bucket. Folding them into
    // CONFIRM would invent agreement nobody expressed.
    expect(out.byHumanResponse.none).toEqual({ total: 1, improved: 0, unchanged: 1, worsened: 0 });
    // The buckets are a partition of the scored total — no double counting.
    const summed = Object.values(out.byHumanResponse).reduce((n, b) => n + b.total, 0);
    expect(summed).toBe(out.total);
  });

  it('collects reason codes as evidence, attached only where a judgement exists', async () => {
    const out = await getSimilarOutcomes({ workspaceId: WS, verdict: 'KILL' });
    expect(out.byHumanReason.TOF_ROLE).toEqual({ total: 2, improved: 1, unchanged: 0, worsened: 1 });
  });

  it('makes NO claim that a human was right — only what followed', async () => {
    // The contract is correlational and must stay so. An overridden KILL that
    // improved is a sequence, not a vindication; nothing here may compute a
    // per-response accuracy, win rate, or CONFIRM-vs-OVERRIDE comparison.
    const out = await getSimilarOutcomes({ workspaceId: WS, verdict: 'KILL' });
    const serialized = JSON.stringify(out);
    for (const forbidden of ['correct', 'wrong', 'humanAccuracy', 'winRate', 'humanWasRight', 'overrideAccuracy']) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const bucket of Object.values(out.byHumanResponse)) {
      expect(Object.keys(bucket).sort()).toEqual(['improved', 'total', 'unchanged', 'worsened']);
    }
    // The existing surface keeps its meaning: `confidence` is over outcomes,
    // never over people.
    expect(out.confidence).toBeCloseTo(out.improved / out.total, 10);
  });

  it('respects the MIN_SAMPLE floor — a thin history reports nothing at all', async () => {
    // A two-row history must not surface a breakdown; "0 overrides" from a
    // sample this size is not a fact about the account.
    const thin = await getSimilarOutcomes({ workspaceId: OTHER_WS, verdict: 'KILL' });
    expect(thin).toBeNull();
  });
});
