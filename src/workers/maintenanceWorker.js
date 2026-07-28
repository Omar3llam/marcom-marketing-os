// ============================================================
// MARCOM / Lumi — Maintenance Worker
// ------------------------------------------------------------
// Housekeeping that keeps unbounded tables bounded. Today that is one job:
// the ai_usage_logs retention sweep.
//
// ALWAYS ON, unlike the agentic and narrative crons. Those are opt-in because
// they SPEND — every tick fans out to the AI gateway. This one only deletes,
// and an opt-in retention sweep is a retention sweep nobody enables, which is
// exactly the unbounded growth it exists to prevent. ai_usage_logs takes a row
// per AI call and is the highest-volume writer in the system.
//
// The safety is in the helper, not in a flag: cleanAiUsageLogs deletes nothing
// younger than AIUSAGE_MAX_AGE_DAYS and clamps a junk or non-positive value
// back to 90 days, so a misconfigured env cannot move the cutoff forward and
// empty the table.
//
// Unlike the metering WRITE (best-effort, swallows everything), a failed sweep
// is surfaced: a sweep that silently did nothing is a table growing forever
// while the logs claim it was cleaned.
// ============================================================
import { Worker } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { MAINTENANCE_QUEUE_NAME, AI_USAGE_CLEANUP_JOB, scheduleAiUsageCleanup } from '../queues/index.js';
import { cleanAiUsageLogs } from '../lib/aiUsage.js';
import { logger } from '../utils/logger.js';

/**
 * Route one maintenance job. Exported so the dispatch is testable without
 * standing up a Worker (which needs a live Redis).
 *
 * An unrecognised job name is reported rather than silently treated as a
 * success — a maintenance queue that quietly no-ops is indistinguishable from
 * one that is working.
 */
export async function runMaintenanceJob(job) {
  const name = job?.name;

  if (name === AI_USAGE_CLEANUP_JOB) {
    const deleted = await cleanAiUsageLogs();
    return { job: name, deleted };
  }

  logger.warn({ jobName: name }, '[maintenance] unknown job name — nothing run');
  return { job: name ?? null, skipped: true };
}

export function startMaintenanceWorker() {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    runMaintenanceJob,
    {
      connection:  bullConnection,
      prefix:      QUEUE_PREFIX,
      concurrency: 1, // a retention delete never needs to run twice at once
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, '[maintenance] job failed');
  });

  // No enable flag and therefore no unschedule counterpart: scheduleAiUsageCleanup
  // removes its own previous registration before re-adding, so changing
  // AIUSAGE_CLEANUP_CRON replaces the schedule instead of running both.
  scheduleAiUsageCleanup()
    .then(() => logger.info('[maintenance] ai-usage retention sweep scheduled'))
    .catch((err) =>
      logger.warn({ err: err.message }, '[maintenance] schedule deferred — Redis unreachable?'),
    );

  logger.info('[maintenance] worker started');
  return worker;
}
