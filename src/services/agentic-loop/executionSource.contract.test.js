// ============================================================
// B4-B — the agentic loop's EXECUTE stage, and what may satisfy it
// ============================================================
// The stage answers exactly one question:
//
//     did LUMI successfully execute a mutation on the platform?
//
// It does not answer "did a human act on this recommendation", and the two are
// separately recorded columns since B4-A. So three things must all be true, and
// a green suite that proves only the first is not enough:
//
//   1. platformExecutedAt   SATISFIES the stage
//   2. humanExecutedAt      does NOT — a self-report is intervention, not proof
//      that Lumi did anything, and interventionAt (the union of the two) is
//      therefore also disqualified
//   3. Action.status        does NOT — B3-C retired every producer of Action
//      rows, so the old source could only ever report a dead substrate as a
//      dead loop. SC-2 then dropped the table, which is why the tests below
//      no longer build a legacy row to be ignored: the input is now
//      unconstructible rather than merely disregarded.
//
// Everything below runs against the REAL database, because what is being tested
// IS the query predicate: a Prisma mock returns whatever it was told to for
// `platformExecutedAt`, for `humanExecutedAt` and for `workspaceId` alike, and
// would pass with any of the three sources wired up. Only the read-services
// around the query are doubled — none of them is the subject.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

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
const { prisma }      = await import('../../lib/prisma.js');
const { buildLoopInputs } = await import('./AgenticLoopService.js');
const { planAgenda }      = await import('./agenticPlanner.js');
const { STAGE_STATE, LOOP_STAGE } = await import('./agenticTypes.js');

const DB_OK = await dbAvailable();

const WS_A   = '00000000-0000-4000-8000-00000000b4b0';
const WS_B   = '00000000-0000-4000-8000-00000000b4b1';
const ENTITY = '00000000-0000-4000-8000-00000000b4b2';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

const makeDecision = (workspaceId, over = {}) => prisma.decision.create({
  data: {
    workspaceId, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    verdict: 'KILL', confidence: 0.8, diagnosis: 'B4-B fixture',
    channel: 'META', objective: 'OUTCOME_SALES', status: 'PROPOSED', ...over,
  },
  select: { id: true },
});


/** The EXECUTE stage as the loop actually computes it, end to end. */
async function executeStage(workspaceId) {
  const inputs = await buildLoopInputs(workspaceId, { now: NOW });
  const agenda = planAgenda(inputs);
  return {
    inputs,
    agenda,
    stage: agenda.stageStatus.find((s) => s.stage === LOOP_STAGE.EXECUTE),
  };
}

describe('B4-B — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B4-B — EXECUTE is sourced from platform execution evidence', () => {
  beforeAll(async () => {
    for (const id of [WS_A, WS_B]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `B4B-${id.slice(-1)}` } });
    }
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  });
  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
  });

  // ── T1 ────────────────────────────────────────────────────────────────────
  it('T1 · a missing Action table can no longer hold EXECUTE stale', async () => {
    await makeDecision(WS_A, { platformExecutedAt: daysAgo(1) });
    // Non-vacuous, and more so than before. This used to assert the retired
    // substrate was EMPTY, so a stage still reading it would have to report
    // STALE here. SC-2 dropped the table, so a stage still reading it could
    // not answer at all — that assertion moved to T6, where the substrate
    // being unconstructible is the claim rather than a precondition.

    const { stage } = await executeStage(WS_A);
    expect(stage.state).toBe(STAGE_STATE.ACTIVE);
    expect(stage.count).toBe(1);
    expect(stage.lastAt).toBe(daysAgo(1).toISOString());
  });

  // ── T2 ────────────────────────────────────────────────────────────────────
  it('T2 · a human self-report alone does NOT satisfy EXECUTE', async () => {
    await makeDecision(WS_A, { humanExecutedAt: daysAgo(1), platformExecutedAt: null });

    const { inputs, stage } = await executeStage(WS_A);
    // The evidence set is empty — not "empty of recent rows", empty of rows.
    expect(inputs.platformExecutions).toEqual([]);
    expect(stage.count).toBe(0);
    expect(stage.lastAt).toBeNull();
    expect(stage.state).toBe(STAGE_STATE.STALE);
  });

  it('T2b · and the loop says so out loud rather than reporting progress', async () => {
    // A PROPOSED verdict puts an item in the buyer band, so the honest reading
    // of "proposals waiting, nothing executed" is a stale EXECUTE stage. The
    // point is that a self-report must not buy its way out of that state.
    await makeDecision(WS_A, { rootCause: null, humanExecutedAt: daysAgo(1) });
    const { agenda } = await executeStage(WS_A);
    expect(agenda.staleStages).toContain(LOOP_STAGE.EXECUTE);
  });

  // ── T3 ────────────────────────────────────────────────────────────────────
  it('T3 · a platform execution IS visible to the loop', async () => {
    const d = await makeDecision(WS_A, { platformExecutedAt: daysAgo(2) });

    const { inputs, stage } = await executeStage(WS_A);
    expect(inputs.platformExecutions.map((r) => r.id)).toEqual([d.id]);
    expect(stage.state).toBe(STAGE_STATE.ACTIVE);
    expect(stage.lastAt).toBe(daysAgo(2).toISOString());
  });

  // ── T4 ────────────────────────────────────────────────────────────────────
  it('T4 · with both timestamps, only the platform one is used', async () => {
    // The human timestamp is deliberately the OLDER of the two, which is what
    // separates the three candidate sources:
    //   platformExecutedAt → daysAgo(1)  → ACTIVE   the contract
    //   interventionAt     → daysAgo(20) → IDLE     earliest of the two
    //   humanExecutedAt    → daysAgo(20) → IDLE
    await makeDecision(WS_A, { humanExecutedAt: daysAgo(20), platformExecutedAt: daysAgo(1) });

    const { stage } = await executeStage(WS_A);
    expect(stage.lastAt).toBe(daysAgo(1).toISOString());
    expect(stage.state).toBe(STAGE_STATE.ACTIVE);
    expect(stage.count).toBe(1);
  });

  it('T4b · the human timestamp changes nothing about the stage', async () => {
    await makeDecision(WS_A, { humanExecutedAt: daysAgo(20), platformExecutedAt: daysAgo(1) });
    const withHuman = (await executeStage(WS_A)).stage;

    await prisma.decision.updateMany({ where: { workspaceId: WS_A }, data: { humanExecutedAt: null } });
    const withoutHuman = (await executeStage(WS_A)).stage;

    expect(withHuman).toEqual(withoutHuman);
  });

  // ── T5 ────────────────────────────────────────────────────────────────────
  it('T5 · one workspace cannot see the executions of another', async () => {
    const a = await makeDecision(WS_A, { platformExecutedAt: daysAgo(1) });
    await makeDecision(WS_B, { platformExecutedAt: null });

    const seenByB = await executeStage(WS_B);
    expect(seenByB.inputs.platformExecutions).toEqual([]);
    expect(seenByB.stage.state).toBe(STAGE_STATE.STALE);

    // A's own row is still there, so B's emptiness is isolation and not a
    // fixture that never landed.
    const seenByA = await executeStage(WS_A);
    expect(seenByA.inputs.platformExecutions.map((r) => r.id)).toEqual([a.id]);
  });

  // ── T6 ────────────────────────────────────────────────────────────────────
  it('T6 · SC-2 · the row that could have fabricated progress cannot be built', async () => {
    // This used to CREATE a leftover EXECUTED_SUCCESS Action row — the exact
    // input the pre-B4-B query would have believed — and prove the stage
    // ignored it. SC-2 dropped the table after production measured it at 0
    // rows, so that row is no longer constructible.
    //
    // The guarantee is not weaker, it is stronger, and it moved one layer
    // down: 'the stage ignores this input' becomes 'this input cannot exist'.
    // Both halves are asserted, because a stale generated client would let the
    // delegate outlive a schema that no longer declares the model.
    expect(prisma.action).toBeUndefined();
    expect(readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8'))
      .not.toMatch(/^model Action \{/m);

    // …and the behavioural half survives unchanged: no platform execution
    // means STALE, with nothing else able to stand in for one.
    await makeDecision(WS_A, { platformExecutedAt: null });
    const { inputs, stage } = await executeStage(WS_A);
    expect(inputs.platformExecutions).toEqual([]);
    expect(stage.count).toBe(0);
    expect(stage.state).toBe(STAGE_STATE.STALE);
  });

  it('T6b · a real execution is still counted once, with its own timestamp', async () => {
    // The arithmetic half of the old T6b. It asserted that a legacy Action row
    // was not counted as a SECOND execution and that its fresher timestamp did
    // not become the stage's. The row is gone; what survives is that one
    // platform execution yields exactly one, dated by itself.
    await makeDecision(WS_A, { platformExecutedAt: daysAgo(3) });

    const { stage } = await executeStage(WS_A);
    expect(stage.count).toBe(1);
    expect(stage.lastAt).toBe(daysAgo(3).toISOString());
  });
});

// ── Source-authority ratchet ────────────────────────────────────────────────
// Runs with or without a database. The DB tests above prove the CURRENT source
// behaves; these prove no future edit can quietly re-point it, which is the
// failure this slice exists to end — the last one survived a full audit because
// the query kept working, on a table that had stopped being written.
//
// Comments are stripped first. The prose above and in the service explains what
// was retired BY NAME, and a raw grep would score the explanation as the defect.
describe('B4-B — the loop may not re-acquire a non-platform execution source', () => {
  const code = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const service = () => code('./AgenticLoopService.js');
  const planner = () => code('./agenticPlanner.js');

  it('reads Decision.platformExecutedAt, workspace-scoped', () => {
    const s = service();
    expect(s).toMatch(/platformExecutedAt:\s*\{\s*gte:\s*since\s*\}/);
    // The scope predicate must live in the SAME where clause as the evidence.
    // C-10 — the reader now DECLARES that it accepts every class before the
    // window predicate. "Did Lumi land a mutation" is class-agnostic by nature,
    // and saying so is what stops it looking like a forgotten filter.
    expect(s).toMatch(/where:\s*\{\s*workspaceId,\s*\.\.\.scopeFor\('loop\/platform-executions'\),\s*platformExecutedAt:/);
  });

  it('no longer queries the retired Action substrate', () => {
    expect(service()).not.toMatch(/prisma\.action\./);
  });

  it('never sources execution progress from human or union evidence', () => {
    for (const src of [service(), planner()]) {
      expect(src).not.toMatch(/humanExecutedAt/);
      expect(src).not.toMatch(/interventionAt/);
      expect(src).not.toMatch(/legacyExecutedAt/);
    }
  });

  it('the planner reads the platform column by name', () => {
    expect(planner()).toMatch(/freshest\(platformExecutions,\s*'platformExecutedAt'\)/);
  });
});
