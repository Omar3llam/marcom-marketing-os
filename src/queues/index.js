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

export const ACTION_QUEUE_NAME   = 'actions';
export const OBSERVER_QUEUE_NAME = 'observer';
export const SYNC_QUEUE_NAME     = 'campaign-sync';

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
export const actionQueue   = REDIS_DISABLED ? null : new Queue(ACTION_QUEUE_NAME,   queueOpts);
export const observerQueue = REDIS_DISABLED ? null : new Queue(OBSERVER_QUEUE_NAME, queueOpts);
export const syncQueue     = REDIS_DISABLED ? null : new Queue(SYNC_QUEUE_NAME,     queueOpts);

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
