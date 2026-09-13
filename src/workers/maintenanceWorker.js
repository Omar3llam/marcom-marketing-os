// ============================================================
// MARCOM / Lumi — Maintenance Worker
// ------------------------------------------------------------
// Scheduled work that must happen whether or not anyone is looking. Three jobs:
//
//   ai-usage-cleanup     — keeps the highest-volume table bounded.
//   learning-extraction  — R10: derives this account's patterns from its own
//                          executed decisions and their measured outcomes.
//   plan-closure         — C-18: ends plans whose period has passed, and makes
//                          no claim about whether their goals were met.
//
// They share a queue because they share the property that defines it: always
// on, and spending nothing. Extraction is deterministic (patternEngine holds no
// LLM, no randomness, no network), which is why it belongs beside a retention
// sweep rather than behind the agentic cron's AI-spend flag.
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
import {
  MAINTENANCE_QUEUE_NAME, AI_USAGE_CLEANUP_JOB, scheduleAiUsageCleanup,
  LEARNING_EXTRACTION_JOB, scheduleLearningExtraction,
  PLAN_CLOSURE_JOB, schedulePlanClosure,
  EXECUTION_TIMEOUT_JOB, scheduleExecutionTimeout,
} from '../queues/index.js';
import { cleanAiUsageLogs } from '../lib/aiUsage.js';
import { runLearningSweep } from '../services/pattern-engine/learningSweep.js';
import { runPlanClosureSweep } from '../services/planning/planClosureSweep.js';
import { runExecutionTimeoutSweep } from '../services/execution/executionTimeoutSweep.js';
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

  // R10 (Phase C) — pattern extraction. Deliberately NOT swallowed: like the
  // retention sweep beside it, a learning job that quietly did nothing is
  // indistinguishable from one that worked, and the whole point of moving
  // extraction here was that nobody was watching it happen. Per-workspace
  // failures are already isolated inside the sweep; a throw here means the
  // sweep itself could not run.
  if (name === LEARNING_EXTRACTION_JOB) {
    const result = await runLearningSweep();
    return { job: name, ...result };
  }

  // C-18 — administrative closure. Not swallowed either: a plan that failed to
  // close stays "the active plan" for its workspace, and Lumi keeps tracking the
  // goals of a period that finished.
  if (name === PLAN_CLOSURE_JOB) {
    const result = await runPlanClosureSweep();
    return { job: name, ...result };
  }

  // Slice D — the execution timeout backstop. Not swallowed either, and for the
  // sharpest version of the reason: this sweep is the only thing that can move
  // an execution out of an in-flight state when its next transition never
  // arrives. A sweep that failed quietly would leave exactly the zombie rows it
  // exists to resolve, and leave them looking like executions still in progress.
  if (name === EXECUTION_TIMEOUT_JOB) {
    const result = await runExecutionTimeoutSweep();
    return { job: name, ...result };
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

  // R10 (Phase C). Same shape as its neighbour and for the same reasons: no
  // enable flag (extraction spends nothing, and a flag would recreate the
  // starvation), and self-replacing registration so a changed cron does not
  // leave two schedules running.
  scheduleLearningExtraction()
    .then(() => logger.info('[maintenance] learning-extraction sweep scheduled'))
    .catch((err) =>
      logger.warn({ err: err.message }, '[maintenance] learning schedule deferred — Redis unreachable?'),
    );

  // C-18. Same shape and the same reasoning as the two above: no enable flag
  // (one UPDATE spends nothing, and a flag would recreate the starvation this
  // job exists to end), and self-replacing registration.
  schedulePlanClosure()
    .then(() => logger.info('[maintenance] plan-closure sweep scheduled'))
    .catch((err) =>
      logger.warn({ err: err.message }, '[maintenance] plan-closure schedule deferred — Redis unreachable?'),
    );

  // Slice D. Same shape and the same reasoning as the three above, with one
  // addition: this is the backstop for the execution lifecycle itself, so a
  // deferred registration is worth seeing in the logs rather than inferring
  // later from rows that never resolved.
  scheduleExecutionTimeout()
    .then(() => logger.info('[maintenance] execution-timeout sweep scheduled'))
    .catch((err) =>
      logger.warn({ err: err.message }, '[maintenance] execution-timeout schedule deferred — Redis unreachable?'),
    );

  logger.info('[maintenance] worker started');
  return worker;
}
