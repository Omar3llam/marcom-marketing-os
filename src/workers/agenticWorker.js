// ============================================================
// MARCOM / Lumi — Agentic Loop Worker (Phase 9)
// ------------------------------------------------------------
// The proactivity heartbeat. Every AGENTIC_CRON tick, run the unified
// detect→propose sweep for each active workspace — so Lumi surfaces
// decisions/tests/plan-adjustments WITHOUT a manual trigger. Mirrors
// startObserverWorker.
//
// Human-in-the-loop is preserved: the sweep only writes PROPOSED rows +
// a LoopRun audit. Nothing executes here.
//
// Degrades: when Redis is disabled the worker simply isn't started; the
// on-read stale-sweep in AgentHomeService keeps the loop proactive in dev.
// ============================================================
import { Worker } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { AGENTIC_QUEUE_NAME, scheduleAgenticSweep } from '../queues/index.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { runSweep } from '../services/agentic-loop/AgenticLoopService.js';

const MAX_WORKSPACES = Number(process.env.AGENTIC_MAX_WORKSPACES || 500);

/** Sweep every workspace once. Bounded; serialised by concurrency:1. */
export async function runAgenticSweepAll() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: MAX_WORKSPACES });
  let swept = 0;
  for (const ws of workspaces) {
    try {
      await runSweep(ws.id, { trigger: 'SCHEDULED' });
      swept += 1;
    } catch (err) {
      logger.warn({ err: err.message, workspaceId: ws.id }, '[agentic] workspace sweep failed');
    }
  }
  logger.info({ workspaces: workspaces.length, swept }, '[agentic] scheduled sweep complete');
  return { workspaces: workspaces.length, swept };
}

export function startAgenticWorker() {
  const worker = new Worker(
    AGENTIC_QUEUE_NAME,
    async () => runAgenticSweepAll(),
    {
      connection:  bullConnection,
      prefix:      QUEUE_PREFIX,
      concurrency: 1, // sweeps must be serialised
    },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, '[agentic] sweep job failed');
  });
  scheduleAgenticSweep().catch((err) =>
    logger.warn({ err: err.message }, '[agentic] schedule deferred — Redis unreachable?'),
  );
  logger.info('[agentic] worker started');
  return worker;
}
