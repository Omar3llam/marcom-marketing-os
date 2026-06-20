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
import { getPortfolio } from '../portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { trackPlan } from '../planning/PlanService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';

const LOOKBACK_DAYS = Number(process.env.LOOP_LOOKBACK_DAYS || 30);
// How recently a sweep must have run to be reused instead of re-swept.
export const LOOP_MIN_INTERVAL_MS = Number(process.env.LOOP_MIN_INTERVAL_MS || 15 * 60 * 1000);
const AGENTIC_CRON_MS = Number(process.env.LOOP_INTERVAL_MS || 15 * 60 * 1000);

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
 * Load every organ's surface into the planner's inputs. Each source is
 * best-effort (a cold organ never fails the whole sweep). Shared read path for
 * runSweep + AgentHomeService.getHome.
 */
export async function buildLoopInputs(workspaceId, { now = new Date() } = {}) {
  if (!workspaceId) throw new Error('buildLoopInputs: workspaceId required');
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const safe = (p, fallback) => p.catch(() => fallback);

  const [
    guardrailVerdicts, fatiguePredictions, openTests, plans, allocationPlans,
    executedActions, recentOutcomes, recentMemory, labelsById,
  ] = await Promise.all([
    safe(prisma.decision.findMany({ where: { workspaceId, status: 'PROPOSED', rootCause: { startsWith: 'guardrail:' } }, orderBy: { createdAt: 'desc' }, take: 100 }), []),
    safe(prisma.fatiguePrediction.findMany({ where: { workspaceId, resolvedAt: null }, orderBy: { projectedBreachDate: 'asc' }, take: 100 }), []),
    safe(prisma.testExperiment.findMany({ where: { workspaceId, status: 'RUNNING' }, orderBy: { startedAt: 'desc' }, take: 20 }), []),
    safe(prisma.plan.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10, include: { goals: true } }), []),
    safe(prisma.allocationPlan.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10 }), []),
    safe(prisma.action.findMany({ where: { workspaceId, status: 'EXECUTED_SUCCESS', executedAt: { gte: since } }, select: { id: true, executedAt: true }, take: 100 }), []),
    safe(prisma.outcomeSnapshot.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { id: true, createdAt: true }, take: 100 }), []),
    safe(prisma.decisionMemoryEntry.findMany({ where: { workspaceId, createdAt: { gte: since } }, select: { id: true, createdAt: true }, take: 100 }), []),
    safe(loadLabels(workspaceId), new Map()),
  ]);

  // Pacing + blended + plan tracking via the existing services (best-effort).
  const [portfolio, blended, testAgenda] = await Promise.all([
    safe(getPortfolio(workspaceId), null),
    safe(getBlendedTruth(workspaceId), null),
    safe(getWeeklyAgenda(workspaceId).then((a) => a.slice(0, 5)), []),
  ]);
  const activePlan = plans.find((p) => p.status === 'ACTIVE') ?? plans[0] ?? null;
  const planTracking = activePlan ? await safe(trackPlan(workspaceId, activePlan, { now }), null) : null;

  return {
    guardrailVerdicts, fatiguePredictions, pacing: pacingFromPortfolio(portfolio),
    testAgenda, openTests, planTracking, blended,
    plans, allocationPlans, executedActions, recentOutcomes, recentMemory, labelsById, now,
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
  // 1. detect→propose: the organs that WRITE forward signals. Each is
  //    best-effort (a cold organ never fails the sweep) and runs BEFORE
  //    buildLoopInputs so this sweep also surfaces what it just wrote. None
  //    auto-executes: guardrails + connector verdicts write PROPOSED Decisions
  //    the human confirms; the forecaster writes read-side FatiguePrediction
  //    radar artifacts (and resolves any that have now actually breached).
  await Promise.all([
    sweepGuardrails(workspaceId).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] guardrail sweep skipped')),
    sweepFatigue(workspaceId, { now }).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] fatigue sweep skipped')),
    persistConnectorVerdicts(workspaceId).catch((err) => logger.warn({ err: err.message, workspaceId }, '[AgenticLoop] connector verdict sweep skipped')),
  ]);

  // 2. load the unified picture and plan the agenda.
  const inputs = await buildLoopInputs(workspaceId, { now });
  const agenda = planAgenda(inputs);

  // 3. audit the sweep.
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
  });

  logger.info({ workspaceId, trigger, loopHealth: agenda.loopHealth, buyer: agenda.buyerBand.length, strategist: agenda.strategistBand.length }, '[AgenticLoop] sweep complete');
  return { loopRun, agenda };
}

/** Latest LoopRun + the estimated next scheduled run. */
export async function getLoopState(workspaceId) {
  if (!workspaceId) throw new Error('getLoopState: workspaceId required');
  const last = await prisma.loopRun.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  const nextRunAt = last ? new Date(new Date(last.createdAt).getTime() + AGENTIC_CRON_MS).toISOString() : null;
  return { lastRun: last, nextRunAt, intervalMs: AGENTIC_CRON_MS };
}
