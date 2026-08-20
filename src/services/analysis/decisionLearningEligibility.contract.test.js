// ============================================================
// C1 — what earns a decision a place in the learning population
// ============================================================
// The sentence this data renders is "N of M similar decisions improved AFTER
// ACTION". Until C1 the gate was `intentAt`, which is stamped when an operator
// copies the recommendation text or clicks through to the ad platform. Neither
// event observes an ad account. The correction is to the EVIDENCE, not to the
// wording: eligibility is now the canonical intervention union.
//
// Every test here runs against real Postgres, because the subject under test is
// a DATABASE PREDICATE. A Prisma mock returns the rows it was handed no matter
// what the `where` says, so a mocked suite would pass with the old gate, the
// new gate, or no gate at all. The unit suite beside this one asserts the
// query's SHAPE; only this one can assert which rows come back.
//
// The population change is BIDIRECTIONAL, which is the part a "tightening"
// mental model gets wrong — T3 proves rows leave, T7 proves rows enter.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const { getSimilarOutcomes } = await import('./decisionLearning.js');
const { decisionsRouter } = await import('../../routes/lumi/decisions.js');

const DB_OK = await dbAvailable();

const WS     = '00000000-0000-4000-8000-0000000000c1';
const ENTITY = '00000000-0000-4000-8000-0000000000c2';

// One similarity key, shared by every row, so nothing is excluded for being
// incomparable and the only variable left is the evidence under test.
const KEY = Object.freeze({
  verdict: 'KILL', rootCause: 'LOW_CTR', entityLevel: 'CAMPAIGN',
  objective: 'OUTCOME_SALES', channel: 'META',
});

const AT = new Date('2026-08-01T10:00:00.000Z');

const makeDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, confidence: 0.8, diagnosis: 'C1 fixture',
    status: 'PROPOSED', ...KEY, ...over,
  },
  select: { id: true },
});

/**
 * Three rows that are unambiguously eligible, so `getSimilarOutcomes` clears
 * its MIN_SAMPLE floor and returns an object at all. Every test then adds ONE
 * subject row carrying `UNCHANGED`, which makes inclusion readable off a single
 * field: `unchanged === 1` means the subject was counted, `0` means it was not.
 */
const seedControls = () => Promise.all([1, 2, 3].map(() =>
  makeDecision({ resolution: 'IMPROVED', humanExecutedAt: AT })));

const ask = () => getSimilarOutcomes({ workspaceId: WS, ...KEY });

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.workspaceId = WS; req.collabRole = 'BUYER';
    req.userId = 'user-c1'; req.userRole = 'MEMBER';
    next();
  });
  a.use('/api/lumi', decisionsRouter);
  return a;
};

describe('C1 — this contract must actually run', () => {
  it('CI provides a migrated database', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('C1 — learning eligibility is intervention, not engagement', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'C1' } });
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await seedControls();
  });

  it('the control seed alone is eligible and scored', async () => {
    // Non-vacuous baseline: every assertion below reads a delta against this,
    // so a seed that was itself excluded would make "excluded" unfalsifiable.
    const out = await ask();
    expect(out).not.toBeNull();
    expect(out.total).toBe(3);
    expect(out.improved).toBe(3);
    expect(out.unchanged).toBe(0);
  });

  // ── T1 ────────────────────────────────────────────────────────────────────
  it('T1 · a human-reported intervention enters the population', async () => {
    await makeDecision({ resolution: 'UNCHANGED', humanExecutedAt: AT, platformExecutedAt: null, intentAt: null });
    const out = await ask();
    expect(out.unchanged).toBe(1);
    expect(out.total).toBe(4);
  });

  // ── T2 ────────────────────────────────────────────────────────────────────
  it('T2 · a platform intervention enters the population', async () => {
    await makeDecision({ resolution: 'UNCHANGED', humanExecutedAt: null, platformExecutedAt: AT, intentAt: null });
    const out = await ask();
    expect(out.unchanged).toBe(1);
    expect(out.total).toBe(4);
  });

  // ── T3 ────────────────────────────────────────────────────────────────────
  it('T3 · intent WITHOUT intervention does not enter — the defect, directly', async () => {
    // Copied the recommendation, or opened Meta. Then did nothing. The campaign
    // moved anyway, and the old gate counted that as "improved after action".
    await makeDecision({ resolution: 'UNCHANGED', intentAt: AT, humanExecutedAt: null, platformExecutedAt: null });
    const out = await ask();
    expect(out.unchanged).toBe(0);
    expect(out.total).toBe(3);
  });

  // ── T4 ────────────────────────────────────────────────────────────────────
  it('T4 · engaged AND intervened enters, once', async () => {
    await makeDecision({ resolution: 'UNCHANGED', intentAt: AT, humanExecutedAt: AT });
    const out = await ask();
    expect(out.unchanged).toBe(1);
    expect(out.total).toBe(4);
  });

  // ── T5 ────────────────────────────────────────────────────────────────────
  it('T5 · an unresolved decision stays out however hard it was acted on', async () => {
    // Action alone proves an intervention happened. It does not supply the
    // outcome the sentence is counting, and a row with no resolution has no
    // "improved" or "worsened" to contribute.
    await makeDecision({ resolution: null, humanExecutedAt: AT, platformExecutedAt: AT });
    const out = await ask();
    expect(out.total).toBe(3);
    expect(out.unchanged).toBe(0);
    // The row is not merely uncounted — it never left the database. `unscored`
    // is where an unresolved row would surface if the resolution predicate were
    // dropped, and reporting it as "we measured nothing here" would be a
    // different lie from excluding it.
    expect(out.unscored).toBe(0);
  });


  // ── T6 ────────────────────────────────────────────────────────────────────
  it('T6 · the legacy executedAt alias alone cannot qualify a row', async () => {
    // `executedAt` is the deprecated pre-split column. Nothing writes it and
    // nothing may read it as authority — it cannot say WHICH kind of execution
    // it recorded, which is the whole reason B4-A split it in two.
    await makeDecision({ resolution: 'UNCHANGED', executedAt: AT, humanExecutedAt: null, platformExecutedAt: null });
    const out = await ask();
    expect(out.unchanged).toBe(0);
    expect(out.total).toBe(3);
  });

  // ── T7 ────────────────────────────────────────────────────────────────────
  it('T7 · intervention WITHOUT intent enters — rows the old gate never saw', async () => {
    // "I did this" is reachable from the Home decision card, a surface with no
    // copy button and no platform link. Those verdicts were acted on and could
    // never be stamped with intent, so the old gate excluded them permanently.
    // This is the direction a "we are tightening the population" reading misses.
    const d = await makeDecision({ resolution: 'UNCHANGED', intentAt: null, humanExecutedAt: AT });

    const row = await prisma.decision.findUnique({ where: { id: d.id }, select: { intentAt: true } });
    expect(row.intentAt).toBeNull(); // the fixture is what the test claims it is

    const out = await ask();
    expect(out.unchanged).toBe(1);
    expect(out.total).toBe(4);
  });

  it('T7b · all four evidence states remain representable, and only two count', async () => {
    // §7's independence table. The controls stay in place so the sample still
    // clears MIN_SAMPLE; the four subjects are tagged so the shape assertion
    // reads them and nothing else.
    const TAG = 'C1 four-state';
    const states = [
      { intentAt: null, humanExecutedAt: null },  // ignored / unknown
      { intentAt: AT,   humanExecutedAt: null },  // engaged, action unproven
      { intentAt: null, humanExecutedAt: AT   },  // acted, engagement untracked
      { intentAt: AT,   humanExecutedAt: AT   },  // engaged and acted
    ];
    for (const s of states) await makeDecision({ resolution: 'UNCHANGED', diagnosis: TAG, ...s });

    const rows = await prisma.decision.findMany({
      where: { workspaceId: WS, diagnosis: TAG },
      select: { intentAt: true, humanExecutedAt: true },
    });
    const shape = rows.map((r) => `${r.intentAt ? 'I' : '-'}${r.humanExecutedAt ? 'A' : '-'}`).sort();
    expect(shape).toEqual(['--', '-A', 'I-', 'IA']);

    // …and exactly the two carrying an intervention are counted. Intent is
    // orthogonal: it neither admits a row nor keeps one out.
    const out = await ask();
    expect(out.unchanged).toBe(2);
    expect(out.total).toBe(5);
  });


  // ── T8 ────────────────────────────────────────────────────────────────────
  it('T8 · the intent flow still works and touches no execution column', async () => {
    // intentAt is NOT deprecated by this slice. It remains the only adoption
    // signal the system has; what changed is that learning stopped reading it.
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    const d = await makeDecision({});

    const res = await request(app()).patch(`/api/lumi/decisions/by-entity/${ENTITY}/intent`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, recorded: true });

    const row = await prisma.decision.findUnique({
      where: { id: d.id },
      select: { intentAt: true, humanExecutedAt: true, platformExecutedAt: true },
    });
    expect(row.intentAt).toBeTruthy();
    expect(row.humanExecutedAt).toBeNull();
    expect(row.platformExecutedAt).toBeNull();
  });

  it('T8b · …and that engagement alone still does not reach learning', async () => {
    // The two halves of C1 in one test: the signal is preserved AND it is inert
    // as evidence. Proving either alone would leave the other assumable.
    const d = await makeDecision({ resolution: 'UNCHANGED' });
    await request(app()).patch(`/api/lumi/decisions/by-entity/${ENTITY}/intent`).send({});

    const row = await prisma.decision.findUnique({ where: { id: d.id }, select: { intentAt: true } });
    expect(row.intentAt).toBeTruthy();

    const out = await ask();
    expect(out.unchanged).toBe(0);
  });

  // ── Workspace scope, unchanged by this slice but easy to break with it ─────
  it('another workspace’s interventions are not counted here', async () => {
    const OTHER = '00000000-0000-4000-8000-0000000000c3';
    await prisma.workspace.upsert({ where: { id: OTHER }, update: {}, create: { id: OTHER, name: 'C1-other' } });
    await prisma.decision.create({
      data: {
        workspaceId: OTHER, entityId: ENTITY, confidence: 0.8, diagnosis: 'C1 other-workspace',
        status: 'PROPOSED', resolution: 'UNCHANGED', humanExecutedAt: AT, ...KEY,
      },
    });
    try {
      const out = await ask();
      expect(out.total).toBe(3);
      expect(out.unchanged).toBe(0);
    } finally {
      await prisma.decision.deleteMany({ where: { workspaceId: OTHER } });
      await prisma.workspace.deleteMany({ where: { id: OTHER } });
    }
  });
});
