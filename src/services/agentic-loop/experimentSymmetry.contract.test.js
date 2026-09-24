// ============================================================
// C-13 — Experiment symmetry: one class, two live objects  (RED)
// ------------------------------------------------------------
// R-3 unified Test and Incrementality into ONE Decision class. R-A ruled that
// the class enters Attention through its LIVE object, never by promoting its
// historical Decision into current state.
//
// On `ea07e13` the runtime still holds two objects with opposite halves:
//
//                        enters Attention   by-id read
//   TestExperiment            YES (2 reads)    ABSENT
//   IncrementalityTest        NO  (0 reads)    exists
//
// So a strategist can have a causal holdout running — the most expensive,
// slowest, most deliberate thing Lumi can be doing — and Attention says
// nothing, silently, with no absence marker. Not a lie; an incomplete
// population published as a complete one.
//
// ── WHY THE POPULATION HALF RUNS AGAINST REAL POSTGRES ──────────────────────
//
// What is under test IS the query predicate. A Prisma mock returns whatever it
// was told to for `status: 'RUNNING'`, for DESIGNED and for another workspace
// alike, so a mocked suite would pass with the predicate wired to anything at
// all — including to nothing. Only the services AROUND the read are doubled;
// none of them is the subject.
//
// The projection half is pure: `planAgenda` takes rows and returns items, so it
// needs no database and must not have one.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DECISION_CLASS } from '@marcom/runtime-contracts';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../guardrail-engine/GuardrailSweepService.js', () => ({ sweepGuardrails: vi.fn().mockResolvedValue() }));
vi.mock('../fatigue-forecaster/FatigueSweepService.js', () => ({ sweepFatigue: vi.fn().mockResolvedValue() }));
vi.mock('../verdict-engine/VerdictService.js', () => ({ persistConnectorVerdicts: vi.fn().mockResolvedValue() }));
vi.mock('../verdict-engine/index.js', () => ({
  getConnectorVerdicts:      vi.fn().mockResolvedValue({ verdicts: [] }),
  evaluateConnectorVerdicts: vi.fn().mockResolvedValue({ verdicts: [] }),
  failedEvaluation:          vi.fn(() => ({ verdicts: [] })),
}));
vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn().mockResolvedValue([]) }));
vi.mock('../analysis/AccountHealthService.js', () => ({ computeAccountHealth: vi.fn(() => ({ campaigns: [] })) }));
vi.mock('../portfolio/PortfolioService.js', () => ({ getPortfolio: vi.fn().mockResolvedValue(null) }));
vi.mock('../test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn().mockResolvedValue([]) }));
vi.mock('../planning/PlanService.js', () => ({ trackPlan: vi.fn().mockResolvedValue(null) }));
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn().mockResolvedValue(null) }));

const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma }          = await import('../../lib/prisma.js');
const { buildLoopInputs } = await import('./AgenticLoopService.js');
const { planAgenda }      = await import('./agenticPlanner.js');
const { AGENDA_TYPE }     = await import('./agenticTypes.js');

const DB_OK = await dbAvailable();

const WS_A   = '00000000-0000-4000-8000-0000000c1300';
const WS_B   = '00000000-0000-4000-8000-0000000c1301';
const CAMP_A = '00000000-0000-4000-8000-0000000c1302';
const CAMP_B = '00000000-0000-4000-8000-0000000c1303';

const NOW = new Date('2026-09-04T12:00:00.000Z');

// IncrementalityTest has seven columns with no default. A fixture that omits
// one names a row PostgreSQL would refuse, and a fixture the database would
// reject is a weak fixture — C-11 learned that on `guardrailRuleId`.
const makeHoldout = (workspaceId, over = {}) => prisma.incrementalityTest.create({
  data: {
    workspaceId, name: 'C-13 holdout', channel: 'META',
    entityId: CAMP_A, entityLevel: 'CAMPAIGN',
    holdoutPct: 0.2, mde: 0.1, sampleSizePerArm: 1000, durationDays: 14,
    guardrails: {}, ...over,
  },
  select: { id: true },
});

// ── The projection fixtures. Plain rows: planAgenda reads no database. ──────
// `CREATIVE_ANGLE`, not `CREATIVE`: TestDimension is an enum and a fixture the
// database would reject is a weak fixture, even in a test that never touches it.
const openTest = (over = {}) => ({
  id: 'te-1', dimension: 'CREATIVE_ANGLE', metric: 'CTR', status: 'RUNNING',
  hypothesis: 'Static beats video', entityId: CAMP_A, entityLevel: 'CAMPAIGN',
  startedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const openHoldout = (over = {}) => ({
  id: 'ho-1', name: 'META holdout', channel: 'META', status: 'RUNNING',
  entityId: CAMP_A, entityLevel: 'CAMPAIGN',
  startedAt: new Date('2026-09-02T00:00:00Z'), ...over,
});

const band = (inputs) => planAgenda({ now: NOW, ...inputs }).buyerBand;

describe('C-13 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A1 · the population — both live objects, and only what is live
// ────────────────────────────────────────────────────────────────────────────
describe.skipIf(!DB_OK)('C-13 · A1 — a running holdout is part of the Experiment population', () => {
  beforeAll(async () => {
    for (const id of [WS_A, WS_B]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `C13-${id.slice(-1)}` } });
    }
  });
  afterAll(async () => {
    await prisma.incrementalityTest.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  });
  beforeEach(async () => {
    await prisma.incrementalityTest.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
  });

  it('T1 · a RUNNING holdout reaches the loop inputs', async () => {
    const { id } = await makeHoldout(WS_A, { status: 'RUNNING' });
    const inputs = await buildLoopInputs(WS_A, { now: NOW });
    expect(inputs.openHoldouts.map((h) => h.id)).toEqual([id]);
  });

  it('T2 · DESIGNED and CONCLUDED are not live, and do not enter', async () => {
    // The symmetry is with `TestExperiment status: RUNNING`, not with "any
    // holdout row". A holdout that has been designed asks the strategist for
    // nothing yet, and a concluded one has already been read out.
    await makeHoldout(WS_A, { status: 'DESIGNED' });
    await makeHoldout(WS_A, { status: 'CONCLUDED' });
    await makeHoldout(WS_A, { status: 'ABANDONED' });
    const inputs = await buildLoopInputs(WS_A, { now: NOW });
    expect(inputs.openHoldouts).toEqual([]);
  });

  it('T3 · another workspace’s running holdout is invisible', async () => {
    await makeHoldout(WS_B, { status: 'RUNNING' });
    const inputs = await buildLoopInputs(WS_A, { now: NOW });
    expect(inputs.openHoldouts).toEqual([]);
  });

  it('T4 · a failed holdout read cannot become an empty experiment population', async () => {
    // A complete Home must know both running experiment populations. A failed
    // holdout read cannot publish zero holdouts while sibling reads succeed.
    const spy = vi.spyOn(prisma.incrementalityTest, 'findMany')
      .mockRejectedValueOnce(new Error('holdout read exploded'));
    await expect(buildLoopInputs(WS_A, { now: NOW }))
      .rejects.toMatchObject({ source: 'HOLDOUTS' });
    spy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A2 / A3 / A5 · the projection — what a person is actually handed
// ────────────────────────────────────────────────────────────────────────────
describe('C-13 · A2 — the holdout is published as an attention item', () => {
  it('T5 · a running holdout produces exactly one item, keyed by experiment id', () => {
    // R-C: Experiment deduplicates by experiment id. Its own namespace, so it
    // can never collide with `test-open:` on a shared uuid.
    const items = band({ openHoldouts: [openHoldout()] });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('holdout-open:ho-1');
    expect(items[0].evidenceRef).toBe('ho-1');
  });

  it('T6 · it carries the EXPERIMENT class, though its row is not a Decision', () => {
    // Ruling 7. `decisionClass` on an attention item names the class of the
    // ITEM, not of the table it was read from. Any other reading makes R-A
    // unimplementable: the class would exist only on the Decision rows R-A
    // forbids promoting into current state.
    const [item] = band({ openHoldouts: [openHoldout()] });
    expect(item.decisionClass).toBe(DECISION_CLASS.EXPERIMENT);
  });

  it('T7 · it names its subject, so a destination can resolve it', () => {
    const [item] = band({ openHoldouts: [openHoldout()] });
    expect(item.subjectRef).toEqual({ kind: 'HOLDOUT', id: 'ho-1' });
  });

  it('T8 · it carries the entity the holdout runs on', () => {
    const [item] = band({ openHoldouts: [openHoldout()] });
    expect(item.entityId).toBe(CAMP_A);
  });

  it('T9 · a holdout with no entity says null rather than inventing one', () => {
    const [item] = band({ openHoldouts: [openHoldout({ entityId: null })] });
    expect(item.entityId).toBeNull();
  });

  it('T10 · it asks for a read, not an action, at the severity of a thing in flight', () => {
    const [item] = band({ openHoldouts: [openHoldout()] });
    expect(item.severity).toBe('LOW');
    expect(item.humanAction).toBe('review');
    expect(item.type).toBe(AGENDA_TYPE.TEST);
  });
});

describe('C-13 · A3 — the open test finally publishes what it always had', () => {
  it('T11 · entityId is written on the row and must reach the item', () => {
    // F-3. `TestExperiment.entityId` exists and BOTH publishers dropped it, so
    // the item could not be labelled, scored, or resolved to a campaign.
    const [item] = band({ openTests: [openTest()] });
    expect(item.entityId).toBe(CAMP_A);
  });

  it('T12 · it carries the same class as its sibling half', () => {
    const [item] = band({ openTests: [openTest()] });
    expect(item.decisionClass).toBe(DECISION_CLASS.EXPERIMENT);
  });

  it('T13 · it names its subject with its own kind', () => {
    const [item] = band({ openTests: [openTest()] });
    expect(item.subjectRef).toEqual({ kind: 'AB_TEST', id: 'te-1' });
  });

  it('T14 · with a resolvable entity it is titled like a verdict is', () => {
    const labelsById = new Map([[CAMP_A, 'Summer Sale']]);
    const [item] = band({ openTests: [openTest()], labelsById });
    expect(item.title).toContain('Summer Sale');
  });

  it('T15 · with no label it falls back rather than printing "undefined"', () => {
    const [item] = band({ openTests: [openTest()] });
    expect(item.title).not.toMatch(/undefined|null/);
    expect(item.title).toBeTruthy();
  });
});

describe('C-13 · R-C — two experiments on one entity are two items', () => {
  it('T16 · a test and a holdout on the SAME campaign both survive', () => {
    // The assumption R-C removed, one object over: attention identity is not
    // entity identity. A campaign under an A/B test AND a causal holdout owes
    // the operator two readings, not one.
    const items = band({ openTests: [openTest()], openHoldouts: [openHoldout()] });
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
    expect(new Set(items.map((i) => i.subjectRef.kind))).toEqual(new Set(['AB_TEST', 'HOLDOUT']));
  });

  it('T17 · two holdouts on different campaigns are two items', () => {
    const items = band({
      openHoldouts: [openHoldout(), openHoldout({ id: 'ho-2', entityId: CAMP_B })],
    });
    expect(items.map((i) => i.id).sort()).toEqual(['holdout-open:ho-1', 'holdout-open:ho-2']);
  });
});

describe('C-13 · A5 — what must NOT acquire a class', () => {
  it('T18 · an unpersisted weekly suggestion is a proposal to RUN an experiment', () => {
    // It is not one yet. `decisionClassLabel(null)` returns null and the client
    // says nothing — which is the honest answer. Stamping EXPERIMENT here would
    // claim a running experiment exists on the strength of a suggestion.
    const [item] = band({ testAgenda: [{ name: 'Try static creative', hypothesis: 'h', entityId: CAMP_A }] });
    expect(item.decisionClass).toBeNull();
    expect(item.subjectRef).toBeNull();
  });

  it('T19 · a fatigue forecast is still classless', () => {
    const [item] = band({
      fatiguePredictions: [{ id: 'f-1', entityId: CAMP_A, metric: 'frequency', projectedBreachDate: '2026-09-10T00:00:00Z' }],
    });
    expect(item.decisionClass).toBeNull();
    expect(item.subjectRef).toBeNull();
  });
});
