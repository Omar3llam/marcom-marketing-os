// ============================================================
// GET /api/execute/vitals — Runtime vitals for the Operations panel
// ============================================================
// Returns rolling runtime vitals for the requesting workspace.
// Powers Operations · RuntimeHealthStrip.
//
// Response fields:
//   inFlightCount    — executions currently in a non-terminal state
//   successPerHour   — EXECUTED_SUCCESS transitions in the last hour
//   failedPerHour    — failure/timeout transitions in the last hour
//   p95LatencyMs     — 95th-percentile end-to-end latency (terminal rows)
//   deadLetterCount  — BullMQ failed jobs after all retry attempts. Invariant VI-3.
//   stalePendingCount — ExecutionRequests stuck at PENDING > STALE_PENDING_MS. Scenario 7.
//   activeWorkerCount — workers with a live heartbeat key in Redis. Invariant V-3.
//   queueDepth       — current waiting + delayed job count in executionQueue.
//   serverNow        — server timestamp
//   windowMinutes    — metric window (always 60)
//
// p95 is computed in JS over a single Prisma fetch — the dataset
// is small (one hour of terminal executions per workspace).
// Switch to raw SQL percentile_cont() if volume grows beyond
// ~10k/hour per workspace.
// ============================================================
import { prisma }               from '../../lib/prisma.js';
import { logger }               from '../../utils/logger.js';
import { executionQueue }       from '../../queues/index.js';
import { getWorkerHeartbeats }  from '../../services/execution/workerHealth.js';
import { IN_FLIGHT_STATUSES, FAILURE_STATUSES } from '@marcom/runtime-contracts';

// Executions stuck at PENDING longer than this are "orphaned" — see failure-scenarios.md §7.
const STALE_PENDING_MS = Number(process.env.STALE_PENDING_MS || 2 * 60 * 1_000); // 2 minutes

/**
 * 95th percentile latency (ms) over a list of executions with
 * createdAt + updatedAt. Returns null for empty input.
 *
 * Uses linear-interpolation percentile (nearest-rank with fraction)
 * for stable, non-jittery vitals on small samples.
 */
function computeP95Latency(records) {
  if (!records || records.length === 0) return null;

  const durations = records
    .map((r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) return null;
  if (durations.length === 1) return durations[0];

  const rank  = 0.95 * (durations.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return Math.round(durations[lower] + (durations[upper] - durations[lower]) * weight);
}

export function registerVitalsRoute(router) {
  router.get('/vitals', async (req, res) => {
    const workspaceId = req.workspaceId;
    const userId      = req.userId;
    const now        = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
    const staleBefore = new Date(now.getTime() - STALE_PENDING_MS);

    try {
      // DB queries — workspace-scoped, run in parallel.
      const [
        inFlightCount,
        successPerHour,
        failedPerHour,
        terminalDurations,
        stalePendingCount,
      ] = await Promise.all([
        prisma.executionRequest.count({
          where: { workspaceId, status: { in: IN_FLIGHT_STATUSES } },
        }),
        prisma.executionRequest.count({
          where: {
            workspaceId,
            status: 'EXECUTED_SUCCESS',
            updatedAt: { gte: oneHourAgo },
          },
        }),
        prisma.executionRequest.count({
          where: {
            workspaceId,
            status: { in: FAILURE_STATUSES },
            updatedAt: { gte: oneHourAgo },
          },
        }),
        prisma.executionRequest.findMany({
          where: {
            workspaceId,
            status: { in: ['EXECUTED_SUCCESS', ...FAILURE_STATUSES] },
            updatedAt: { gte: oneHourAgo },
          },
          select: { createdAt: true, updatedAt: true },
        }),
        // Orphaned PENDING — see failure-scenarios.md §7.
        prisma.executionRequest.count({
          where: {
            workspaceId,
            status:    'PENDING',
            createdAt: { lt: staleBefore },
          },
        }),
      ]);

      const p95LatencyMs = computeP95Latency(terminalDurations);

      // Queue-level health — graceful degradation when Redis is unavailable.
      let deadLetterCount   = null;
      let queueDepth        = null;
      let activeWorkerCount = null;

      if (executionQueue) {
        try {
          [deadLetterCount, queueDepth] = await Promise.all([
            executionQueue.getFailedCount(),
            executionQueue.count(),
          ]);
        } catch (qErr) {
          logger.warn({ err: qErr.message }, '[Vitals] queue stats unavailable');
        }
      }

      try {
        const workers = await getWorkerHeartbeats();
        activeWorkerCount = workers.length;
      } catch (hErr) {
        logger.warn({ err: hErr.message }, '[Vitals] heartbeat read failed');
      }

      logger.debug({
        workspaceId, userId,
        inFlightCount, successPerHour, failedPerHour, p95LatencyMs,
        deadLetterCount, stalePendingCount, queueDepth, activeWorkerCount,
        sampleSize: terminalDurations.length,
      }, '[ExecutionRouter] Runtime vitals');

      return res.json({
        inFlightCount,
        successPerHour,
        failedPerHour,
        p95LatencyMs,
        deadLetterCount,
        stalePendingCount,
        queueDepth,
        activeWorkerCount,
        serverNow:     now.toISOString(),
        windowMinutes: 60,
      });
    } catch (err) {
      logger.error('[ExecutionRouter] Vitals fetch failed', {
        workspaceId, userId, error: err.message, stack: err.stack,
      });
      return res.status(500).json({
        error: 'Failed to fetch runtime vitals',
        code:  'VITALS_ERROR',
      });
    }
  });
}
