// ============================================================
// MARCOM / Lumi — BullMQ Queue Registry
// ------------------------------------------------------------
// Resilience: when src/queues/connection.js sets REDIS_DISABLED
// (no REDIS_URL in production, or REDIS_URL points at localhost),
// we export `null` queues + helpers that throw a clear error.
// Routes that depend on the queue MUST short-circuit on
// `if (!actionQueue)` and return 503.
// ============================================================
import { Queue } from 'bullmq';
import {
  bullConnection,
  QUEUE_PREFIX,
  REDIS_DISABLED,
} from './connection.js';

export const ACTION_QUEUE_NAME     = 'actions';
export const OBSERVER_QUEUE_NAME   = 'observer';
export const SYNC_QUEUE_NAME       = 'campaign-sync';
export const EXECUTION_QUEUE_NAME  = 'executions';
export const AGENTIC_QUEUE_NAME    = 'agentic';
export const NARRATIVE_QUEUE_NAME  = 'narrative';
// Housekeeping that keeps unbounded tables bounded. Generic on purpose — the
// next retention sweep should share this queue rather than mint another.
export const MAINTENANCE_QUEUE_NAME = 'maintenance';
// The job NAME is also its jobId, so the worker can branch on job.name and the
// scheduler can find its own repeatable by id.
export const AI_USAGE_CLEANUP_JOB = 'ai-usage-cleanup';
// R10 (Phase C) — pattern extraction, on a schedule instead of on a page view.
// It shares the maintenance queue rather than minting a new one, exactly as the
// note above invites: the queue's defining property is "always on, spends
// nothing", and deterministic extraction has both.
export const LEARNING_EXTRACTION_JOB = 'learning-extraction';

const queueOpts = {
  connection: bullConnection,
  prefix:     QUEUE_PREFIX,
  defaultJobOptions: {
    attempts:     3,
    backoff:      { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },
    removeOnFail:     { age: 60 * 60 * 24 * 7 },
  },
};

// When Redis is disabled, all queues are `null`. Importers must
// guard with `if (!actionQueue) return 503`.
export const actionQueue    = REDIS_DISABLED ? null : new Queue(ACTION_QUEUE_NAME,    queueOpts);
export const observerQueue  = REDIS_DISABLED ? null : new Queue(OBSERVER_QUEUE_NAME,  queueOpts);
export const syncQueue      = REDIS_DISABLED ? null : new Queue(SYNC_QUEUE_NAME,      queueOpts);
export const executionQueue = REDIS_DISABLED ? null : new Queue(EXECUTION_QUEUE_NAME, queueOpts);
export const agenticQueue   = REDIS_DISABLED ? null : new Queue(AGENTIC_QUEUE_NAME,   queueOpts);
export const narrativeQueue = REDIS_DISABLED ? null : new Queue(NARRATIVE_QUEUE_NAME, queueOpts);
export const maintenanceQueue = REDIS_DISABLED ? null : new Queue(MAINTENANCE_QUEUE_NAME, queueOpts);

// ── Helper: enqueue an ExecutionRequest ──────────────────────
// Called by meta.js after PENDING → QUEUED transition.
// jobId = executionId for BullMQ-level idempotency (duplicate
// enqueue of the same executionId is a no-op).
export async function enqueueExecution({ executionId, workspaceId, userId, actionType, targetId, options }) {
  if (!executionQueue) {
    throw new Error('Execution queue unavailable — set REDIS_URL to a real Redis instance');
  }
  return executionQueue.add(
    'execute',
    { executionId, workspaceId, userId, actionType, targetId, options },
    {
      jobId:   executionId,
      attempts: Number(process.env.EXECUTION_MAX_RETRIES || 3),
      backoff:  { type: 'exponential', delay: 5_000 },
    },
  );
}

// ── Helper: enqueue an Action row ────────────────────────────
export async function enqueueAction(actionRow) {
  if (!actionQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  return actionQueue.add(
    'execute',
    { actionId: actionRow.id, workspaceId: actionRow.workspaceId },
    { jobId: actionRow.idempotencyKey },
  );
}

// ── Helper: schedule the temporal observer ───────────────────
export async function scheduleObserver() {
  if (!observerQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  const cron = process.env.OBSERVER_CRON || '*/15 * * * *';
  await observerQueue.add(
    'sweep',
    {},
    {
      jobId:   'observer-cron',
      repeat:  { pattern: cron },
    },
  );
}

// ── Helper: schedule the agentic loop sweep (Phase 9) ────────
// The proactivity heartbeat: every AGENTIC_CRON the worker runs the unified
// detect→propose sweep for each workspace. Mirrors scheduleObserver.
export async function scheduleAgenticSweep() {
  if (!agenticQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  const cron = process.env.AGENTIC_CRON || '*/15 * * * *';
  await agenticQueue.add(
    'sweep',
    {},
    {
      jobId:   'agentic-cron',
      repeat:  { pattern: cron },
    },
  );
}

// ── Helper: remove the agentic sweep repeat (AGENTIC_CRON_ENABLED=false) ─────
// BullMQ repeatables PERSIST in Redis: merely not re-adding 'agentic-cron' on
// boot would leave a previously-registered repeat firing forever. Removal is by
// key lookup (not a pattern-matched removeRepeatable) so a repeat registered
// under an OLD AGENTIC_CRON value is still found and stopped.
export async function unscheduleAgenticSweep() {
  if (!agenticQueue) return 0; // Redis off → nothing was ever scheduled
  const jobs = await agenticQueue.getRepeatableJobs();
  let removed = 0;
  for (const j of jobs) {
    if (j.id === 'agentic-cron') {
      await agenticQueue.removeRepeatableByKey(j.key);
      removed += 1;
    }
  }
  return removed;
}

// ── Helper: schedule the weekly + monthly narrative cadence (Phase 8) ────────
// The reporting heartbeat: a LEADERSHIP stakeholder narrative is authored
// automatically (Monday 08:00 weekly, 1st-of-month 08:00 monthly). The worker
// skips workspaces with no real activity in the window — no empty-report spam.
// Mirrors scheduleAgenticSweep; both jobs share one queue, distinguished by data.
export async function scheduleNarratives() {
  if (!narrativeQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  const weekly  = process.env.NARRATIVE_WEEKLY_CRON  || '0 8 * * 1'; // Monday 08:00 UTC
  const monthly = process.env.NARRATIVE_MONTHLY_CRON || '0 8 1 * *'; // 1st of month 08:00 UTC
  await narrativeQueue.add('generate', { period: 'WEEKLY' },  { jobId: 'narrative-weekly-cron',  repeat: { pattern: weekly } });
  await narrativeQueue.add('generate', { period: 'MONTHLY' }, { jobId: 'narrative-monthly-cron', repeat: { pattern: monthly } });
}

// ── Helper: remove the narrative repeats (AI_AUTOMATIC_ENABLED != true) ───────
// Mirrors unscheduleAgenticSweep. The weekly/monthly narratives author reports via
// the AI gateway (automatic spend). BullMQ repeatables PERSIST in Redis, so a
// previously-registered narrative cron would keep firing (and spending) forever
// unless actively torn down on boot when automatic AI is disabled. Removal is by
// key lookup so a repeat registered under an OLD cron value is still found.
export async function unscheduleNarratives() {
  if (!narrativeQueue) return 0; // Redis off → nothing was ever scheduled
  const jobs = await narrativeQueue.getRepeatableJobs();
  let removed = 0;
  for (const j of jobs) {
    if (j.id === 'narrative-weekly-cron' || j.id === 'narrative-monthly-cron') {
      await narrativeQueue.removeRepeatableByKey(j.key);
      removed += 1;
    }
  }
  return removed;
}

// ── Helper: schedule the ai_usage_logs retention sweep ────────
// ALWAYS ON, and deliberately so. Every other cron here is opt-in because it
// SPENDS (agentic sweeps and narratives both fan out to the AI gateway); this
// one only deletes, and defaulting it off would recreate the exact problem it
// exists to solve — ai_usage_logs takes a row per AI call and is the
// highest-volume writer in the system.
//
// Nothing younger than AIUSAGE_MAX_AGE_DAYS is ever touched, and cleanAiUsageLogs
// clamps a junk or non-positive value back to 90 days, so a misconfigured env
// cannot move the cutoff forward and empty the table.
//
// Removes any existing registration before adding. BullMQ repeatables persist in
// Redis keyed by their pattern, so changing AIUSAGE_CLEANUP_CRON would otherwise
// leave the OLD schedule firing alongside the new one — the same hazard
// unscheduleAgenticSweep exists to handle, met here by re-registering rather
// than by a disable flag.
export async function scheduleAiUsageCleanup() {
  if (!maintenanceQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  const cron = process.env.AIUSAGE_CLEANUP_CRON || '0 3 * * *'; // 03:00 UTC daily

  const existing = await maintenanceQueue.getRepeatableJobs();
  for (const j of existing) {
    if (j.id === AI_USAGE_CLEANUP_JOB) {
      await maintenanceQueue.removeRepeatableByKey(j.key);
    }
  }

  await maintenanceQueue.add(
    AI_USAGE_CLEANUP_JOB,
    {},
    {
      jobId:  AI_USAGE_CLEANUP_JOB,
      repeat: { pattern: cron },
    },
  );
}

// ── Helper: schedule the learning-extraction sweep (R10 · Phase C) ───────────
// ALWAYS ON, for the same reason the retention sweep is: an opt-in flag here
// would reproduce the starvation this job exists to end. Extraction is
// deterministic — patternEngine holds no LLM, no randomness and no network — so
// unlike the agentic and narrative crons this one costs no AI spend, and there
// is nothing to protect a user from by defaulting it off.
//
// Runs hourly by default rather than per-minute: outcomes mature over DAYS
// (DEFAULT_CONFIG.maturationDays is 7), so extracting more often re-derives the
// same patterns from the same rows. Hourly keeps a freshly-recorded outcome
// visible on the briefing well within a session.
//
// Re-registers rather than adding: BullMQ repeatables persist in Redis keyed by
// their pattern, so changing LEARNING_EXTRACTION_CRON would otherwise leave the
// OLD schedule firing alongside the new one.
export async function scheduleLearningExtraction() {
  if (!maintenanceQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  const cron = process.env.LEARNING_EXTRACTION_CRON || '17 * * * *'; // hourly, off the hour

  const existing = await maintenanceQueue.getRepeatableJobs();
  for (const j of existing) {
    if (j.id === LEARNING_EXTRACTION_JOB) {
      await maintenanceQueue.removeRepeatableByKey(j.key);
    }
  }

  await maintenanceQueue.add(
    LEARNING_EXTRACTION_JOB,
    {},
    {
      jobId:  LEARNING_EXTRACTION_JOB,
      repeat: { pattern: cron },
    },
  );
}

// ── Helper: schedule automatic campaign sync ──────────────────
export async function scheduleCampaignSync() {
  if (!syncQueue) {
    throw new Error('Queue subsystem unavailable — set REDIS_URL to a real Redis instance');
  }
  // Default: daily at 9 AM UTC (adjust via CAMPAIGN_SYNC_CRON env var)
  const cron = process.env.CAMPAIGN_SYNC_CRON || '0 9 * * *';
  await syncQueue.add(
    'sync-all-workspaces',
    {},
    {
      jobId:   'campaign-sync-cron',
      repeat:  { pattern: cron },
    },
  );
}
