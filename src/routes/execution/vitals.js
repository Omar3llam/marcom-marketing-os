// ============================================================
// GET /api/execute/vitals — Runtime vitals for the Operations panel
// ============================================================
// Returns rolling runtime vitals for the requesting workspace.
// Powers Operations · RuntimeHealthStrip.
//
// Response: {
//   inFlightCount, successPerHour, failedPerHour,
//   p95LatencyMs, serverNow, windowMinutes: 60
// }
//
// p95 is computed in JS over a single Prisma fetch — the dataset
// is small (one hour of terminal executions per workspace).
// Switch to raw SQL percentile_cont() if volume grows beyond
// ~10k/hour per workspace.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { IN_FLIGHT_STATUSES, FAILURE_STATUSES } from '@marcom/runtime-contracts';

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

  const rank = 0.95 * (durations.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return Math.round(durations[lower] + (durations[upper] - durations[lower]) * weight);
}

export function registerVitalsRoute(router) {
  router.get('/vitals', async (req, res) => {
    const { workspaceId, userId } = req.user;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      const [inFlightCount, successPerHour, failedPerHour, terminalDurations] = await Promise.all([
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
      ]);

      const p95LatencyMs = computeP95Latency(terminalDurations);

      logger.debug({
        workspaceId,
        userId,
        inFlightCount,
        successPerHour,
        failedPerHour,
        p95LatencyMs,
        sampleSize: terminalDurations.length,
      }, '[ExecutionRouter] Runtime vitals');

      return res.json({
        inFlightCount,
        successPerHour,
        failedPerHour,
        p95LatencyMs,
        serverNow: now.toISOString(),
        windowMinutes: 60,
      });
    } catch (err) {
      logger.error('[ExecutionRouter] Vitals fetch failed', {
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({
        error: 'Failed to fetch runtime vitals',
        code: 'VITALS_ERROR',
      });
    }
  });
}
