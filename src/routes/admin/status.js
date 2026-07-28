// ============================================================
// MARCOM / Admin — System Status
//   GET /api/admin/status — DB / Redis / queue-depth / worker-cron snapshot
//
// ADMIN-only (gated at the mount in server.js). Every section is independently
// wrapped: a failure in one (e.g. Redis down) degrades that section to
// { ok: false, error } and never throws the whole response. Internal stack
// traces are never leaked — only err.message.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import {
  actionQueue, observerQueue, syncQueue,
  executionQueue, agenticQueue, narrativeQueue, maintenanceQueue,
} from '../../queues/index.js';
import { REDIS_DISABLED, bullConnection } from '../../queues/connection.js';

export const statusRouter = Router();

// Queue registry: stable name → the (possibly null) BullMQ Queue instance.
const QUEUES = {
  'actions':       actionQueue,
  'observer':      observerQueue,
  'campaign-sync': syncQueue,
  'executions':    executionQueue,
  'agentic':       agenticQueue,
  'narrative':     narrativeQueue,
  'maintenance':   maintenanceQueue,
};

async function dbStatus() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function redisStatus() {
  if (REDIS_DISABLED || !bullConnection) {
    return { ok: false, disabled: true };
  }
  try {
    const pong = await bullConnection.ping();
    return { ok: pong === 'PONG', disabled: false };
  } catch (err) {
    return { ok: false, disabled: false, error: err.message };
  }
}

async function queueStatus() {
  const out = {};
  // Sequential by design: a handful of light getJobCounts calls, not a fan-out
  // over an unbounded set (so the arch-check N+1 heuristic stays quiet too).
  for (const [name, queue] of Object.entries(QUEUES)) {
    if (!queue) {
      out[name] = { disabled: true };
      continue;
    }
    try {
      out[name] = await queue.getJobCounts();
    } catch (err) {
      out[name] = { ok: false, error: err.message };
    }
  }
  return out;
}

statusRouter.get('/', async (_req, res) => {
  const [db, redis, queues] = await Promise.all([
    dbStatus(),
    redisStatus(),
    queueStatus(),
  ]);

  res.json({
    db,
    redis,
    queues,
    workers: {
      observer:  { cron: process.env.OBSERVER_CRON         || '*/15 * * * *' },
      agentic:   { cron: process.env.AGENTIC_CRON          || '*/15 * * * *' },
      'campaign-sync': { cron: process.env.CAMPAIGN_SYNC_CRON || '0 9 * * *' },
      'narrative-weekly':  { cron: process.env.NARRATIVE_WEEKLY_CRON  || '0 8 * * 1' },
      'narrative-monthly': { cron: process.env.NARRATIVE_MONTHLY_CRON || '0 8 1 * *' },
      // Retention. `retentionDays` rides along because the schedule alone does
      // not tell an operator what the sweep will delete.
      'ai-usage-cleanup': {
        cron: process.env.AIUSAGE_CLEANUP_CRON || '0 3 * * *',
        retentionDays: Number(process.env.AIUSAGE_MAX_AGE_DAYS) > 0
          ? Number(process.env.AIUSAGE_MAX_AGE_DAYS)
          : 90,
      },
    },
    generatedAt: new Date().toISOString(),
  });
});
