// ============================================================
// MARCOM / Lumi — Narrative Worker (Phase 8)
// ------------------------------------------------------------
// The reporting heartbeat. On the weekly + monthly cron tick, author a
// LEADERSHIP stakeholder narrative for each active workspace — so the reasoned
// report lands WITHOUT a manual trigger. Mirrors startAgenticWorker.
//
// Honest-by-construction: a workspace with no real decision in the window is
// SKIPPED, never given an empty/invented report. The narrative engine itself
// only emits evidence-bound figures, so an authored report is, by construction,
// free of hallucinated numbers.
//
// Degrades: when Redis is disabled the worker simply isn't started; a strategist
// can still author on demand via POST /narratives/generate.
// ============================================================
import { Worker } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { NARRATIVE_QUEUE_NAME, scheduleNarratives, unscheduleNarratives } from '../queues/index.js';
import { prisma } from '../lib/prisma.js';
import { scopeFor } from '../services/decisions/decisionClassScope.js';
import { logger } from '../utils/logger.js';
import { generateNarrative } from '../services/narrative-engine/NarrativeService.js';
import { NARRATIVE_PERIOD, NARRATIVE_AUDIENCE } from '../services/narrative-engine/narrativeTypes.js';

const MAX_WORKSPACES = Number(process.env.NARRATIVE_MAX_WORKSPACES || 500);
const PERIOD_DAYS = Object.freeze({ WEEKLY: 7, MONTHLY: 30 });

/**
 * Author a LEADERSHIP narrative for every workspace with real activity in the
 * window. Bounded; serialised by concurrency:1. A per-workspace failure is
 * logged and skipped — one bad workspace must never stop the sweep.
 *
 * @returns {Promise<{ workspaces:number, generated:number, skipped:number }>}
 */
export async function runNarrativeSweepAll({ period = NARRATIVE_PERIOD.WEEKLY, now = new Date() } = {}) {
  const days = PERIOD_DAYS[period] ?? 7;
  const since = new Date(now.getTime() - days * 86_400_000);
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: MAX_WORKSPACES });

  // One grouped query (NOT an N+1): which workspaces had a real decision in the
  // window. A workspace absent from this set had no activity → skip it, so we
  // never author an empty/invented report.
  const ids = workspaces.map((w) => w.id);
  const activity = ids.length
    ? await prisma.decision.groupBy({
        by: ['workspaceId'],
        // C-10 — ALL classes, declared. A class predicate here would make a
        // workspace with only guardrail activity look dormant, and the worker
        // would decline to write a report about a real week.
        where: { workspaceId: { in: ids }, ...scopeFor('narrative/activity'), createdAt: { gte: since } },
        _count: { _all: true },
      })
    : [];
  const activeIds = new Set(activity.filter((a) => (a._count?._all ?? 0) > 0).map((a) => a.workspaceId));

  let generated = 0;
  let skipped = 0;
  for (const ws of workspaces) {
    if (!activeIds.has(ws.id)) { skipped += 1; continue; }
    try {
      const n = await generateNarrative(ws.id, { period, audience: NARRATIVE_AUDIENCE.LEADERSHIP, actorId: null, now });
      generated += 1;
      logger.info({ workspaceId: ws.id, period, narrativeId: n?.id }, '[narrative] generated');
    } catch (err) {
      logger.warn({ err: err.message, workspaceId: ws.id, period }, '[narrative] workspace generation failed');
    }
  }
  logger.info({ workspaces: workspaces.length, generated, skipped, period }, '[narrative] scheduled sweep complete');
  return { workspaces: workspaces.length, generated, skipped };
}

export function startNarrativeWorker() {
  const worker = new Worker(
    NARRATIVE_QUEUE_NAME,
    async (job) => runNarrativeSweepAll({ period: job?.data?.period }),
    {
      connection:  bullConnection,
      prefix:      QUEUE_PREFIX,
      concurrency: 1, // narrative sweeps must be serialised
    },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, '[narrative] sweep job failed');
  });
  // The weekly/monthly narrative cadence authors LEADERSHIP reports via the AI
  // gateway — automatic AI spend. It is OPT-IN behind AI_AUTOMATIC_ENABLED: the
  // default (unset/anything else) is OFF so every AI request stays manual, and any
  // previously-registered repeat is actively REMOVED (BullMQ repeatables persist in
  // Redis, so skipping the re-add alone would leave an old cron firing forever). A
  // strategist can still author on demand via POST /narratives/generate. Read
  // lazily (not a module const) so tests can flip it per call.
  if (process.env.AI_AUTOMATIC_ENABLED === 'true') {
    scheduleNarratives().catch((err) =>
      logger.warn({ err: err.message }, '[narrative] schedule deferred — Redis unreachable?'),
    );
  } else {
    unscheduleNarratives()
      .then((removed) =>
        logger.info({ removed }, '[narrative] scheduled reports disabled (set AI_AUTOMATIC_ENABLED=true to enable) — manual authoring only'),
      )
      .catch((err) =>
        logger.warn({ err: err.message }, '[narrative] cron-disable cleanup deferred — Redis unreachable?'),
      );
  }
  logger.info('[narrative] worker started');
  return worker;
}
