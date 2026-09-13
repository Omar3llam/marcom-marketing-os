// ============================================================
// AgenticLoopService — run the loop, audit each sweep
// ============================================================
// Owns DB I/O. The agentic NERVOUS SYSTEM:
//   runSweep():  invoke the existing detect→propose organs (sweepGuardrails
//                writes PROPOSED radar verdicts), load the unified picture,
//                run the pure planner, and persist ONE LoopRun audit. Idempotent
//                within a short window. NEVER executes — proposals stay PROPOSED.
//   buildLoopInputs(): load every organ's surface into the planner's inputs
//                (shared with AgentHomeService — single read path).
//   getLoopState(): the latest LoopRun + the next-run estimate.
//
// Reuses the organs already built: sweepGuardrails, getPortfolio (pacing),
// getWeeklyAgenda, trackPlan, getBlendedTruth, and the raw decision/outcome/
// memory rows. No new execution path.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger } from '../../utils/logger.js';
import { planAgenda } from './agenticPlanner.js';
import { sweepGuardrails } from '../guardrail-engine/GuardrailSweepService.js';
import { sweepFatigue } from '../fatigue-forecaster/FatigueSweepService.js';
import { persistConnectorVerdicts } from '../verdict-engine/VerdictService.js';
import { getInstitutionalMemory } from '../pattern-engine/institutionalMemory.js';
import { getConnectorVerdicts, evaluateConnectorVerdicts, failedEvaluation } from '../verdict-engine/index.js';
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { computeAccountHealth } from '../analysis/AccountHealthService.js';
import { getPortfolio } from '../portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { trackPlan } from '../planning/PlanService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { BUYER_ACTIONABLE_ROOT_CAUSES } from '../verdict-engine/decisionIdentity.js';
import { TEMPORAL } from '../../config/temporal.js';

// ACTIVITY recency, NOT sync recency — this one never touches MetricSnapshot.
// It bounds Decision.platformExecutedAt, OutcomeSnapshot.createdAt and
// DecisionMemoryEntry.createdAt: times when something actually happened. Calling
// it a sync bound would have been a fresh inaccuracy in a change about removing
// one. Value unchanged (30).
const ACTIVITY_RECENCY_DAYS = TEMPORAL.loopActivityRecencyDays;
// How recently a sweep must have run to be reused instead of re-swept.
export const LOOP_MIN_INTERVAL_MS = Number(process.env.LOOP_MIN_INTERVAL_MS || 15 * 60 * 1000);
const AGENTIC_CRON_MS = Number(process.env.LOOP_INTERVAL_MS || 15 * 60 * 1000);

// The two Decision families that ARE a "verdict to confirm" for the buyer band:
//   • guardrail hits      → rootCause `guardrail:<rule>`
//   • connector verdicts  → rootCause = a BUYER_ACTIONABLE_ROOT_CAUSES member
//                           (or null when unset). persistConnectorVerdicts
//                           writes these every sweep for both revenue AND
//                           awareness campaigns.
// allocation:/incrementality:/test: decisions are ALSO PROPOSED but have their
// own surfaces (plan review, tests) — deliberately NOT pulled into this band.
//
// The scope is IMPORTED, never restated here. It used to be a local
// `Object.values(SIGNAL_TYPE)`, which was correct on the day it was written and
// silently wrong the day funnel diagnosis shipped: FUNNEL_DROP_* verdicts were
// persisted, counted as connector-authored everywhere else, and invisible here.
// A second copy of a taxonomy cannot be kept in step by discipline alone.

/**
 * Pure: the plan in force, or nothing. Exported for unit testing without a DB.
 *
 * 🔒 C-18. This was `plans.find(p => p.status === 'ACTIVE') ?? plans[0] ?? null`
 * — a fallback that named ANY plan `activePlan` and then had `trackPlan`
 * compute goal landings for it, which reach the strategist band on /lumi/home.
 *
 * The fallback was survivable only because ACTIVE used to be permanent:
 * `PlanStatus.CLOSED` had no writer, so a promoted plan never left the state and
 * `find` almost always hit. C-18 gives closure a writer, so a plan whose period
 * ended now leaves ACTIVE — and the fallback would start firing for exactly the
 * workspaces whose plan just expired, tracking the goals of a finished period
 * and calling them current. Making closure real is what made this line unsafe,
 * so closing it belongs to the same slice.
 */
export function activePlanOf(plans) {
  return (plans ?? []).find((p) => p?.status === 'ACTIVE') ?? null;
}

/**
 * Flatten portfolio pacing into the planner's pacing[] shape.
 *
 * Exported so the spend-window suite tests THIS function and not a copy of it:
 * Attention's over-pacing alarm is only as honest as this seam, and a copy in a
 * test file cannot notice the day the original changes.
 */
export function pacingFromPortfolio(portfolio) {
  const out = [];
  if (portfolio?.pacing?.status && portfolio.pacing.status !== 'ON_TRACK') {
    out.push({ channelId: 'portfolio', channel: 'Portfolio', status: portfolio.pacing.status, daysEarly: portfolio.pacing.daysEarly });
  }
  for (const ch of portfolio?.channels ?? []) {
    if (ch.pacing?.status && ch.pacing.status !== 'ON_TRACK') {
      out.push({ channelId: ch.channelId, channel: ch.channel, status: ch.pacing.status, daysEarly: ch.pacing.daysEarly });
    }
  }
  return out;
}

/** id→name labels for the entities an agenda item might name. */
async function loadLabels(workspaceId) {
  const [accounts, campaigns, adSets] = await Promise.all([
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.adSet.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  return new Map([...accounts, ...campaigns, ...adSets].map((r) => [r.id, r.name]));
}

/**
 * entityId → Impact (1-10): the SAME deterministic priority-to-act the Campaigns
 * page shows. Mirrors the /entities/account-health route EXACTLY — live connector
 * campaigns + their verdicts → computeAccountHealth → per-campaign impact — so a
 * verdict's agenda rank matches its Campaigns-page score. Best-effort by the
 * caller: a cold connector yields an empty map (items fall back to severity order).
 */
async function loadImpactById(workspaceId, evaluation, memory) {
  const [campaigns, cv] = await Promise.all([
    getConnectorCampaigns(workspaceId),
    getConnectorVerdicts(workspaceId, { evaluation, memory }),
  ]);
  const verdictMap = Object.fromEntries((cv?.verdicts ?? []).map((v) => [v.id, v]));
  const health = computeAccountHealth(campaigns, verdictMap);
  return new Map((health?.campaigns ?? []).map((c) => [c.entityId, c.impactScore]));
}

/**
 * Load every organ's surface into the planner's inputs. Each source is
 * best-effort (a cold organ never fails the whole sweep). Shared read path for
 * runSweep + AgentHomeService.getHome.
 *
 * @param {string} workspaceId
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {object} [opts.evaluation] — the sweep's single connector-verdict
 *   evaluation (R8). Threaded through to impact scoring so the sweep does not
 *   compute the same verdicts a second time. A plain home/agenda read supplies
 *   none and gets its own single evaluation — one HTTP request, one evaluation.
 */
export async function buildLoopInputs(workspaceId, { now = new Date(), evaluation, memory } = {}) {
  if (!workspaceId) throw new Error('buildLoopInputs: workspaceId required');
  const since = new Date(now.getTime() - ACTIVITY_RECENCY_DAYS * 86_400_000);
  const safe = (p, fallback) => p.catch(() => fallback);

  const [
    signalVerdicts, guardrailEpisodes, fatiguePredictions, openTests, openHoldouts, plans, allocationPlans,
    platformExecutions, recentOutcomes, recentMemory, labelsById,
  ] = await Promise.all([
    // C-01 / R-C — TWO reads, because the classes do not share a deduplication
    // rule. One `distinct(entityId, entityLevel)` over both was not merely lossy:
    // it asserted that an entity deserves one attention item, which B7-03 ruled
    // false. Attention identity is not entity identity.
    //
    // SIGNAL — one per entity is CORRECT here, and by a real mechanism rather
    // than by convention: VerdictService supersedes the previous connector
    // verdict when it writes a new one, so `distinct` collapses re-sweeps of the
    // same call rather than hiding a second live one. BUYER_ACTIONABLE (not the
    // identity scope) because this read asks who needs a buyer, not who wrote it.
    safe(prisma.decision.findMany({
      where: {
        workspaceId, status: 'PROPOSED',
        // C-10 — the CLASS says whose row it is; BUYER_ACTIONABLE still says
        // which of those findings may ask a buyer for anything. Two questions,
        // and before this ONE `rootCause` list answered both — which is why an
        // identity scope had to have HOLD and INSUFFICIENT_DATA carved out of
        // it to express an actionability one.
        //
        // The `OR` STAYS, and is now purely about actionability. Folding it
        // into a single `in` would drop `{ rootCause: null }`, and null is not
        // an absence here: it is what the engine writes on verdicts it reached
        // without a diagnosis — the early gates especially. Those are real
        // buyer-actionable calls, and collapsing the clause would have silently
        // emptied the band for exactly the campaigns that never got a cause.
        ...scopeFor('loop/signal-verdicts'),
        OR: [
          { rootCause: { in: BUYER_ACTIONABLE_ROOT_CAUSES } },
          { rootCause: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['entityId', 'entityLevel'],
      take: 100,
      // What agenticPlanner's buyer band actually reads. `rationale` is NOT a
      // Decision column — the planner writes `d.rationale ?? d.diagnosis ?? ''`
      // and it is `diagnosis` that exists, so naming the fields also documents
      // which of that pair is real. rootCause rides along because the OR above
      // filters on it and callers group by it.
      select: {
        id: true, entityId: true, entityLevel: true, verdict: true,
        diagnosis: true, rootCause: true, status: true, createdAt: true,
        // C-10 — an unselected column is `undefined`, and the planner would
        // publish null for every item in a band that is scoped by class.
        decisionClass: true,
      },
    }), []),
    // GUARDRAIL — no `distinct`, deliberately. C-02 made an open episode a row
    // the database itself keeps unique, via `@@unique(workspaceId, openHitKey)`,
    // so one entity breaching three rules holds three open episodes and each is
    // its own call. Deduplicating them here would re-impose the very assumption
    // R-C removed.
    //
    // `openHitKey: { not: null }` IS the open-episode population, and it also
    // decides what happens to the pre-C-02 rows: they carry no episode identity,
    // so nothing can say whether they are still open, and they cannot be current
    // attention. This does NOT dispose of them — they stay in the table, in
    // history and in the campaign lens; their fate is still its own decision.
    // Naming it matters because the old `distinct` was collapsing that legacy
    // pile to one row per entity BY ACCIDENT, and removing `distinct` without
    // this filter would bring ~96 rows a day back to the surface.
    safe(prisma.decision.findMany({
      where: { workspaceId, status: 'PROPOSED', ...scopeFor('loop/guardrail-episodes'), openHitKey: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, entityId: true, entityLevel: true, verdict: true,
        diagnosis: true, rootCause: true, status: true, createdAt: true,
        decisionClass: true,
      },
    }), []),
    safe(prisma.fatiguePrediction.findMany({ where: { workspaceId, resolvedAt: null }, orderBy: { projectedBreachDate: 'asc' }, take: 100 }), []),
    safe(prisma.testExperiment.findMany({ where: { workspaceId, status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 20 }), []),
    // C-13 — the OTHER half of the same class. R-3 unified Test and
    // Incrementality; R-A says the class enters Attention through its live
    // object. Reading only one of the two live objects published a partial
    // Experiment population as a complete one, so a running causal holdout —
    // the slowest and most deliberate thing Lumi can be doing — was invisible
    // here while its A/B sibling was not.
    //
    // RUNNING only, mirroring the read above rather than inventing a second
    // rule: DESIGNED asks the strategist for nothing yet and CONCLUDED has
    // already been read out. Two reads, not one `OR` over two tables, because
    // they are two tables — and `safe()` for the same reason as every sibling:
    // one organ's outage must not empty the whole agenda.
    safe(prisma.incrementalityTest.findMany({ where: { workspaceId, status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 20 }), []),
    safe(prisma.plan.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10, include: { goals: true } }), []),
    safe(prisma.allocationPlan.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
    // B4-B — canonical PLATFORM execution evidence, and nothing else.
    //
    // `Decision.platformExecutedAt` has exactly one writer in the system
    // (decisionAttribution.stampDecisionExecuted) and it runs only after the
    // worker has seen Meta accept a mutation — never at queue time, never on a
    // failure. The operator's "I did this myself" writes `humanExecutedAt`, a
    // different column this query deliberately cannot see, because the EXECUTE
    // stage asks whether LUMI turned the loop, not whether a human did.
    //
    // This replaced `prisma.action` WHERE status = EXECUTED_SUCCESS. B3-C
    // retired the actionWorker and with it every producer of Action rows, so
    // that query could only ever return rows nothing writes any more — pinning
    // EXECUTE to STALE and the loop to STALLED however many mutations Lumi
    // actually landed. It reported a dead substrate as a dead loop.
    //
    // `{ gte: since }` carries the NOT NULL too: a null cannot satisfy a range
    // comparison, so an unexecuted decision is excluded by the same predicate
    // that windows the rest. One condition, not two that could drift.
    safe(prisma.decision.findMany({
      // C-10 — ALL classes, declared. 'Did Lumi land a platform mutation' is
      // class-agnostic by nature: the EXECUTE stage asks whether the system
      // turned, and a mutation counts however it was proposed.
      where:  { workspaceId, ...scopeFor('loop/platform-executions'), platformExecutedAt: { gte: since } },
      select: { id: true, platformExecutedAt: true },
      take:   100,
    }), []),
    safe(prisma.outcomeSnapshot.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { id: true, createdAt: true }, take: 100 }), []),
    safe(prisma.decisionMemoryEntry.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { id: true, createdAt: true }, take: 100 }), []),
    safe(loadLabels(workspaceId), new Map()),
  ]);

  // Pacing + blended + plan tracking via the existing services (best-effort).
  // The onboarding objective is a workspace-scoped column (promoted from
  // User.context) that frames the agenda; null when the step was skipped.
  const [portfolio, blended, testAgenda, objective, impactById] = await Promise.all([
    safe(getPortfolio(workspaceId), null),
    safe(getBlendedTruth(workspaceId), null),
    safe(getWeeklyAgenda(workspaceId).then((a) => a.slice(0, 5)), []),
    safe(prisma.workspace.findUnique({ where: { id: workspaceId }, select: { objective: true } }).then((w) => w?.objective ?? null), null),
    safe(loadImpactById(workspaceId, evaluation, memory), new Map()),
  ]);
  // One population again, but assembled from two reads that each kept their own
  // identity rule. Signal first so a re-swept verdict and a standing breach on
  // the same entity arrive in a stable order before the planner ranks them.
  const verdicts = [...signalVerdicts, ...guardrailEpisodes];

  const activePlan = activePlanOf(plans);
  const planTracking = activePlan ? await safe(trackPlan(workspaceId, activePlan, { now }), null) : null;

  return {
    verdicts, fatiguePredictions, pacing: pacingFromPortfolio(portfolio),
    testAgenda, openTests, openHoldouts, planTracking, blended, objective,
    plans, allocationPlans, platformExecutions, recentOutcomes, recentMemory, labelsById, impactById, now,
  };
}

/** Count agenda items by type — the LoopRun.proposalsByType audit. */
function countByType(agenda) {
  const counts = {};
  for (const item of [...agenda.buyerBand, ...agenda.strategistBand]) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Run one full loop sweep. Invokes the proposal-writing organs, plans the
 * agenda, and audits the run. Human-in-the-loop: nothing is executed here.
 * @returns {Promise<{ loopRun, agenda }>}
 */
export async function runSweep(workspaceId, { trigger = 'MANUAL', now = new Date(), force = false } = {}) {
  if (!workspaceId) throw new Error('runSweep: workspaceId required');

  // Idempotency: reuse a very recent sweep unless forced.
  if (!force) {
    const last = await prisma.loopRun.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } }).catch(() => null);
    if (last && now.getTime() - new Date(last.createdAt).getTime() < LOOP_MIN_INTERVAL_MS) {
      logger.debug({ workspaceId, lastRunId: last.id }, '[AgenticLoop] reusing recent sweep');
      return { loopRun: last, agenda: null, reused: true };
    }
  }

  const startedAt = new Date(now);

  // 0. ONE logical evaluation (R8 / I25). A sweep asks "what does the engine say
  //    about this account right now?" exactly once, and the answer is then
  //    carried to everyone who needs it: the persistence sink (step 1), impact
  //    scoring (step 2), per-campaign reasoning (step 4) and portfolio narration
  //    (step 5). Those four used to compute it independently — two to four full
  //    passes over the same evidence per sweep, each read at a different instant,
  //    so a sync landing mid-sweep could store one verdict and narrate another.
  //
  //    A failure is CARRIED, not retried: threading a failedEvaluation makes
  //    every consumer re-raise rather than quietly proceed with an empty verdict
  //    set (I29). It is also why this is not wrapped in `safe` — the marker, not
  //    a null, is what the consumers can distinguish.
  //    C-16 (R-6) — memory is read HERE, once per sweep, beside the evaluation
  //    and never inside it. `connectorVerdictService` states why the two are
  //    parallel rather than nested: the verdict is computed from live signals
  //    alone, and memory arrives afterwards to qualify how SURE we are, never
  //    what we think. Fetching it at this altitude keeps that boundary exactly
  //    as written while giving the writer and the reader the SAME object — the
  //    only way the stored provenance is guaranteed to describe the memory the
  //    published confidence was computed from.
  //
  //    Never throws: a failed read returns MEMORY_UNAVAILABLE, whose factor is
  //    exactly 1.0, so an outage leaves every confidence bit-identical to the
  //    deterministic one and the row records WHY they are identical.
  const [evaluation, memory] = await Promise.all([
    evaluateConnectorVerdicts(workspaceId).catch((err) => {
      logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] connector verdict evaluation failed');
      return failedEvaluation(workspaceId, err);
    }),
    getInstitutionalMemory(workspaceId),
  ]);

  // 1. detect→propose: the organs that WRITE forward signals. Each is
  //    best-effort (a cold organ never fails the sweep) and runs BEFORE
  //    buildLoopInputs so this sweep also surfaces what it just wrote. None
  //    auto-executes: guardrails + connector verdicts write PROPOSED Decisions
  //    the human confirms; the forecaster writes read-side FatiguePrediction
  //    radar artifacts (and resolves any that have now actually breached).
  await Promise.all([
    sweepGuardrails(workspaceId).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] guardrail sweep skipped')),
    sweepFatigue(workspaceId, { now }).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] fatigue sweep skipped')),
    persistConnectorVerdicts(workspaceId, evaluation, { memory }).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] connector verdict sweep skipped')),
  ]);

  // 2. load the unified picture and plan the agenda.
  const inputs = await buildLoopInputs(workspaceId, { now, evaluation, memory });
  const agenda = planAgenda(inputs);

  // 3. audit the sweep.
  //    Explicit projection — mirrors getLoopState's select and deliberately
  //    OMITS aiInsight (populated later by PortfolioAnalysisService, step 5).
  //    Without it, the default create-projection would RETURNING every scalar
  //    column, so a not-yet-migrated ai_insight makes the WRITE throw ("column
  //    loop_runs.ai_insight does not exist") — which is exactly what the manual
  //    "Run sweep" button surfaces as "Request failed". The reads (getLoopState,
  //    getHome) were already hardened this way; this closes the write path too.
  const loopRun = await prisma.loopRun.create({
    data: {
      workspaceId, trigger, startedAt, finishedAt: new Date(),
      proposalsByType: countByType(agenda),
      stageStatus: agenda.stageStatus,
      summary: agenda.summary,
      closed: agenda.closed,
      loopHealth: agenda.loopHealth,
      staleStages: agenda.staleStages,
    },
    select: {
      id: true,
      workspaceId: true,
      trigger: true,
      startedAt: true,
      finishedAt: true,
      proposalsByType: true,
      stageStatus: true,
      summary: true,
      closed: true,
      loopHealth: true,
      staleStages: true,
      createdAt: true,
    },
  });

  logger.info({ workspaceId, trigger, loopHealth: agenda.loopHealth, buyer: agenda.buyerBand.length, strategist: agenda.strategistBand.length }, '[AgenticLoop] sweep complete');

  // Steps 4 + 5 below are the ONLY LLM spend in a sweep (per-campaign reasoning +
  // portfolio narration). By default this fan-out runs ONLY for a user-initiated
  // MANUAL sweep (the "Run sweep" button, a revenue upload) — so every AI request
  // is manual and no background path silently burns tokens. Automatic triggers:
  //   • ON_READ    — a plain home/agenda GET; a frontend poll or uptime monitor
  //                  hitting it 24/7 must ALWAYS stay free (never narrates, even
  //                  when automatic AI is enabled).
  //   • SCHEDULED  — the agentic cron + the post-sync sweep; opt back in with
  //                  AI_AUTOMATIC_ENABLED=true (deliberate, documented spend).
  // The agenda above is already fully deterministic, so skipping the narration
  // never blanks the read. This is the single choke point that keeps AI spend
  // MANUAL regardless of how a sweep got triggered; the finer AGENTIC_CRON_ENABLED
  // / SYNC_TRIGGERS_SWEEP flags still control whether those sweeps fire at all.
  const automaticAiEnabled = process.env.AI_AUTOMATIC_ENABLED === 'true';
  const shouldNarrate = trigger === 'MANUAL' || (trigger === 'SCHEDULED' && automaticAiEnabled);
  if (!shouldNarrate) {
    logger.debug({ workspaceId, trigger, automaticAiEnabled }, '[AgenticLoop] LLM narration skipped — manual-only (set AI_AUTOMATIC_ENABLED=true to narrate scheduled sweeps)');
    return { loopRun, agenda };
  }

  // 4. Pre-generate "Lumi's Read" for the top campaigns so the drill-down is
  //    instant (no on-demand LLM round-trip). Best-effort + dynamically imported:
  //    an AI failure, cold gateway, or missing key never touches the sweep audit.
  try {
    const { generateReasoningForSweep } = await import('../analysis/CampaignReasoningService.js');
    // Threaded, not recomputed (R8): the reasoning must explain the verdicts
    // step 1 actually stored, not a fresh set read moments later.
    await generateReasoningForSweep({ workspaceId, loopRunId: loopRun.id, evaluation });
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] reasoning pre-generation skipped');
  }

  // 5. Portfolio advisory (ANALYZE_PORTFOLIO) → LoopRun.aiInsight for the Overview
  //    AI Insight card. It NARRATES the deterministic verdicts persisted in step 1
  //    — it never assigns or overrides one (PortfolioAnalysisService writes no
  //    Decision rows). Best-effort + dynamically imported: an AI failure, cold
  //    gateway, or missing key never touches the sweep audit.
  //
  //    NOTE: this replaces an inline briefing block that selected
  //    entityId/spendMinor/ctr/roas/isAwareness/revenueMinor from prisma.campaign —
  //    none of which are Campaign columns (they live on MetricSnapshot). Prisma
  //    threw on every run and the block's own catch swallowed it, so aiInsight was
  //    NEVER generated. The service reads getConnectorCampaigns (the projection
  //    that really carries those metrics) instead. That block's capability and
  //    provider methods were left behind unused and have since been deleted.
  try {
    const { runPortfolioAnalysis } = await import('../analysis/PortfolioAnalysisService.js');
    await runPortfolioAnalysis(workspaceId, { loopRunId: loopRun.id, evaluation });
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] portfolio analysis skipped');
  }

  return { loopRun, agenda };
}

/** Latest LoopRun + the estimated next scheduled run. */
export async function getLoopState(workspaceId) {
  if (!workspaceId) throw new Error('getLoopState: workspaceId required');
  // Explicit projection (deliberately excludes aiInsight — unused here and not
  // part of loop state): pins the columns this read pulls, so a newly-added,
  // not-yet-migrated column can never make getLoopState — and therefore getHome —
  // crash the whole agenda. Missing-column staleness degrades to a stale picture.
  const last = await prisma.loopRun.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      trigger: true,
      startedAt: true,
      finishedAt: true,
      proposalsByType: true,
      stageStatus: true,
      summary: true,
      closed: true,
      loopHealth: true,
      staleStages: true,
      createdAt: true,
    },
  });
  const nextRunAt = last ? new Date(new Date(last.createdAt).getTime() + AGENTIC_CRON_MS).toISOString() : null;
  return { lastRun: last, nextRunAt, intervalMs: AGENTIC_CRON_MS };
}
