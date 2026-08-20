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
import { logger } from '../../utils/logger.js';
import { planAgenda } from './agenticPlanner.js';
import { sweepGuardrails } from '../guardrail-engine/GuardrailSweepService.js';
import { sweepFatigue } from '../fatigue-forecaster/FatigueSweepService.js';
import { persistConnectorVerdicts } from '../verdict-engine/VerdictService.js';
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

/** Flatten portfolio pacing into the planner's pacing[] shape. */
function pacingFromPortfolio(portfolio) {
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
async function loadImpactById(workspaceId, evaluation) {
  const [campaigns, cv] = await Promise.all([
    getConnectorCampaigns(workspaceId),
    getConnectorVerdicts(workspaceId, { evaluation }),
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
export async function buildLoopInputs(workspaceId, { now = new Date(), evaluation } = {}) {
  if (!workspaceId) throw new Error('buildLoopInputs: workspaceId required');
  const since = new Date(now.getTime() - ACTIVITY_RECENCY_DAYS * 86_400_000);
  const safe = (p, fallback) => p.catch(() => fallback);

  const [
    verdicts, fatiguePredictions, openTests, plans, allocationPlans,
    platformExecutions, recentOutcomes, recentMemory, labelsById,
  ] = await Promise.all([
    // Buyer-band verdicts = guardrail hits + connector verdicts (revenue +
    // awareness). distinct keeps only the LATEST verdict per entity so a
    // campaign that flips verdicts over time (or is re-swept) surfaces once,
    // not once per historical row.
    safe(prisma.decision.findMany({
      where: {
        workspaceId, status: 'PROPOSED',
        OR: [
          { rootCause: { startsWith: 'guardrail:' } },        // guardrail rule hits
          { rootCause: { in: BUYER_ACTIONABLE_ROOT_CAUSES } },  // connector verdicts
          { rootCause: null },                                 // connector writes `signalType ?? null`
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
      },
    }), []),
    safe(prisma.fatiguePrediction.findMany({ where: { workspaceId, resolvedAt: null }, orderBy: { projectedBreachDate: 'asc' }, take: 100 }), []),
    safe(prisma.testExperiment.findMany({ where: { workspaceId, status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 20 }), []),
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
      where:  { workspaceId, platformExecutedAt: { gte: since } },
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
    safe(loadImpactById(workspaceId, evaluation), new Map()),
  ]);
  const activePlan = plans.find((p) => p.status === 'ACTIVE') ?? plans[0] ?? null;
  const planTracking = activePlan ? await safe(trackPlan(workspaceId, activePlan, { now }), null) : null;

  return {
    verdicts, fatiguePredictions, pacing: pacingFromPortfolio(portfolio),
    testAgenda, openTests, planTracking, blended, objective,
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
  const evaluation = await evaluateConnectorVerdicts(workspaceId).catch((err) => {
    logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] connector verdict evaluation failed');
    return failedEvaluation(workspaceId, err);
  });

  // 1. detect→propose: the organs that WRITE forward signals. Each is
  //    best-effort (a cold organ never fails the sweep) and runs BEFORE
  //    buildLoopInputs so this sweep also surfaces what it just wrote. None
  //    auto-executes: guardrails + connector verdicts write PROPOSED Decisions
  //    the human confirms; the forecaster writes read-side FatiguePrediction
  //    radar artifacts (and resolves any that have now actually breached).
  await Promise.all([
    sweepGuardrails(workspaceId).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] guardrail sweep skipped')),
    sweepFatigue(workspaceId, { now }).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] fatigue sweep skipped')),
    persistConnectorVerdicts(workspaceId, evaluation).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] connector verdict sweep skipped')),
  ]);

  // 2. load the unified picture and plan the agenda.
  const inputs = await buildLoopInputs(workspaceId, { now, evaluation });
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
