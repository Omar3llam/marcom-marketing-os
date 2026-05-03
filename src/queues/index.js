// ============================================================
// MARCOM / Lumi — BullMQ Queue Registry (Phase 2)
// ------------------------------------------------------------
// Two queues are introduced in Phase 2:
//
//   actionQueue   — executes Action rows (Meta/Google ad ops,
//                   pause/scale/budget changes). Uses the
//                   Action.idempotencyKey as the BullMQ jobId so
//                   duplicate webhook deliveries collapse to one
//                   job server-side.
//
//   observerQueue — Phase 3. Repeatable cron job that scans
//                   recently-executed actions and computes
//                   delta KPIs into DecisionMemory.
// ============================================================
import { Queue } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from './connection.js';

export const ACTION_QUEUE_NAME   = 'actions';
export const OBSERVER_QUEUE_NAME = 'observer';

const queueOpts = {
  connection: bullConnection,
  prefix:     QUEUE_PREFIX,
  defaultJobOptions: {
    attempts:     3,
    backoff:      { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },   // 24h / 5k cap
    removeOnFail:     { age: 60 * 60 * 24 * 7 },             // 7 days
  },
};

export const actionQueue   = new Queue(ACTION_QUEUE_NAME,   queueOpts);
export const observerQueue = new Queue(OBSERVER_QUEUE_NAME, queueOpts);

// ── Helper: enqueue an Action row ────────────────────────────
// Uses the row's idempotencyKey as jobId — BullMQ refuses to
// re-add a job with the same jobId, so duplicate webhooks +
// double API calls converge cleanly.
export async function enqueueAction(actionRow) {
  return actionQueue.add(
    'execute',
    { actionId: actionRow.id, workspaceId: actionRow.workspaceId },
    { jobId: actionRow.idempotencyKey },
  );
}

// ── Helper: schedule the temporal observer (Phase 3) ─────────
export async function scheduleObserver() {
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
