// ============================================================
// MARCOM / Lumi — Temporal Observer Service (Phase 3)
// ------------------------------------------------------------
// The "did it work?" loop.
//
// Every OBSERVER_CRON tick the observer:
//
//   1. Finds all actions executed roughly OBSERVER_IMPACT_WINDOW_HRS
//      ago that have NO DecisionMemory row yet.
//   2. Pulls the campaign's healthScore at executedAt vs now and
//      computes deltaCtr / deltaRoas / impactDurationHrs.
//   3. Writes a DecisionMemory row tagging the action sustainable
//      iff the lift held for the full window.
//   4. Updates CampaignState.stage based on the moving average
//      of the last 5 health scores:
//        TESTING   → SCALING  when score crosses 0.6 upward
//        SCALING   → STABLE   when score holds 0.7+ for 3 ticks
//        STABLE    → FATIGUED on -10 % week-over-week
//        FATIGUED  → DYING    on -25 % cumulative
//
// Phase 3 ships the framework + DB writes; the actual KPI
// fetcher (`fetchKpis(campaignId, at)`) is a stub that returns
// deterministic synthetic numbers so the loop is unit-testable.
// Phase 5 swaps the stub for live Meta/Google Insights calls.
// ============================================================
import { Worker }      from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { OBSERVER_QUEUE_NAME, scheduleObserver } from '../queues/index.js';
import { prisma }      from '../lib/prisma.js';
import { logger }      from '../utils/logger.js';

const WINDOW_HRS = Number(process.env.OBSERVER_IMPACT_WINDOW_HRS || 24);

// ── KPI fetcher stub (Phase 5 will replace) ──────────────────
async function fetchKpis(campaignId, _at) {
  // Deterministic mock: hash campaignId so tests are repeatable.
  let h = 0;
  for (const c of campaignId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return {
    ctr:  ((h % 50) / 1000) + 0.01,    // 0.010 – 0.060
    roas: ((h % 30) / 10)   + 1.0,     // 1.0  – 4.0
    healthScore: ((h % 100) / 100),    // 0.00 – 0.99
  };
}

// ── Stage transition logic ───────────────────────────────────
function nextStage(current, recentScores) {
  if (recentScores.length === 0) return current;
  const latest  = recentScores[0];
  const avg     = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  const oldest  = recentScores[recentScores.length - 1];
  const wow     = oldest === 0 ? 0 : (latest - oldest) / oldest;

  switch (current) {
    case 'TESTING':  return latest >= 0.6 ? 'SCALING'  : current;
    case 'SCALING':  return avg    >= 0.7 ? 'STABLE'   : current;
    case 'STABLE':   return wow    <= -0.10 ? 'FATIGUED' : current;
    case 'FATIGUED': return wow    <= -0.25 ? 'DYING'    : current;
    default:         return current;
  }
}

// ── Single sweep — invoked by the cron job ───────────────────
export async function runObserverSweep() {
  const cutoff = new Date(Date.now() - WINDOW_HRS * 60 * 60 * 1000);

  // 1. Find actions that have aged past the impact window.
  const candidates = await prisma.action.findMany({
    where: {
      status:     'EXECUTED_SUCCESS',
      executedAt: { lte: cutoff },
    },
    select: {
      id: true, workspaceId: true, campaignId: true,
      executedAt: true, payload: true,
    },
    take: 200,   // bounded sweep — extras roll into the next tick
  });

  logger.info({ count: candidates.length, cutoff }, '[observer] sweep started');

  if (candidates.length === 0) {
    return { scanned: 0, learned: 0 };
  }

  // ── Pre-fetch: batch load existing memories + campaign states ──
  // Single query per table instead of one per candidate (eliminates N+1).
  const campaignIds = [...new Set(candidates.map(a => a.campaignId))];

  const [existingMemories, currentStates] = await Promise.all([
    prisma.decisionMemory.findMany({
      where:   { campaignId: { in: campaignIds } },
      orderBy: { createdAt: 'desc' },
      select:  { campaignId: true, createdAt: true, deltaRoas: true },
    }),
    prisma.campaignState.findMany({
      where:  { campaignId: { in: campaignIds } },
      select: { campaignId: true, stage: true },
    }),
  ]);

  // Build O(1) lookup maps for the per-action decisions below.
  const memoriesByCampaign = new Map();
  for (const m of existingMemories) {
    if (!memoriesByCampaign.has(m.campaignId)) memoriesByCampaign.set(m.campaignId, []);
    memoriesByCampaign.get(m.campaignId).push(m);
  }
  const stageByCampaign = new Map(currentStates.map(s => [s.campaignId, s.stage]));

  // ── Accumulate writes — no Prisma calls inside this loop ─────
  const newMemories  = [];          // for createMany
  const statePatches = new Map();   // campaignId → patch object

  for (const action of candidates) {
    // Skip if memory already recorded for this campaign after executedAt.
    const priorMemories = memoriesByCampaign.get(action.campaignId) ?? [];
    const hasExisting = priorMemories.some(
      m => new Date(m.createdAt) >= new Date(action.executedAt),
    );
    if (hasExisting) continue;

    let kpiBefore, kpiAfter;
    try {
      [kpiBefore, kpiAfter] = await Promise.all([
        fetchKpis(action.campaignId, action.executedAt),
        fetchKpis(action.campaignId, new Date()),
      ]);
    } catch (err) {
      logger.warn({ err: err.message, actionId: action.id }, '[observer] KPI fetch failed');
      continue;
    }

    const deltaCtr  = kpiAfter.ctr  - kpiBefore.ctr;
    const deltaRoas = kpiAfter.roas - kpiBefore.roas;
    const sustained = deltaCtr >= 0 && deltaRoas >= 0;

    newMemories.push({
      campaignId:        action.campaignId,
      workspaceId:       action.workspaceId,
      actionType:        action.payload?.kind ?? 'unknown',
      decisionRationale: action.payload?.rationale ?? '',
      resultStatus:      sustained ? 'sustained_lift' : 'regression',
      deltaCtr,
      deltaRoas,
      impactDurationHrs: WINDOW_HRS,
      isSustainable:     sustained,
    });

    // Compute next stage from pre-fetched data + new deltaRoas (no DB read).
    const recentScores  = [deltaRoas, ...priorMemories.slice(0, 4).map(m => Number(m.deltaRoas ?? 0))];
    const currentStage  = stageByCampaign.get(action.campaignId) ?? 'TESTING';
    const newStage      = nextStage(currentStage, recentScores);

    statePatches.set(action.campaignId, {
      workspaceId: action.workspaceId,
      stage:       newStage,
      healthScore: kpiAfter.healthScore,
      from:        currentStage,
    });
  }

  // ── Batch writes ──────────────────────────────────────────────
  const learned = newMemories.length;

  if (learned > 0) {
    await prisma.decisionMemory.createMany({ data: newMemories });
  }

  if (statePatches.size > 0) {
    await prisma.$transaction(
      [...statePatches.entries()].map(([campaignId, s]) =>
        prisma.campaignState.upsert({
          where:  { campaignId },
          update: { stage: s.stage, healthScore: s.healthScore, lastAnalysis: new Date() },
          create: {
            campaignId,
            workspaceId:  s.workspaceId,
            stage:        s.stage,
            healthScore:  s.healthScore,
            lastAnalysis: new Date(),
          },
        }),
      ),
    );

    for (const [campaignId, s] of statePatches.entries()) {
      if (s.from !== s.stage) {
        logger.info({ campaignId, from: s.from, to: s.stage }, '[observer] stage transition');
      }
    }
  }

  logger.info({ scanned: candidates.length, learned }, '[observer] sweep complete');
  return { scanned: candidates.length, learned };
}

// ── Worker bootstrap ─────────────────────────────────────────
export function startObserverWorker() {
  const worker = new Worker(
    OBSERVER_QUEUE_NAME,
    async () => runObserverSweep(),
    {
      connection: bullConnection,
      prefix:     QUEUE_PREFIX,
      concurrency: 1,           // sweeps must be serialised
    },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, '[observer] sweep failed');
  });
  scheduleObserver().catch((err) =>
    logger.warn({ err: err.message }, '[observer] schedule deferred — Redis unreachable?'),
  );
  logger.info('[observer] worker started');
  return worker;
}
