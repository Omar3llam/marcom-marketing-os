// ============================================================
// MARCOM / Lumi — Live Execution Metrics (Mission Control)
// GET /api/observability/live
// ============================================================
// Real-time execution health dashboard: active/paused/failed counts,
// queue depth, and recent activity. Read-only, workspace-scoped.
// Auto-refreshed by frontend every 5s for live monitoring.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const liveRouter = Router();

// ─────────────────────────────────────────────────────────────
// GET /api/observability/live
// ─────────────────────────────────────────────────────────────
liveRouter.get('/live', async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Parallel queries for dashboard metrics
    const [
      executionCounts,
      queuedExecutions,
      recentActivity,
    ] = await Promise.all([
      // Count executions by status
      prisma.executionRequest.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { id: true },
      }),

      // Queue depth and oldest queued execution
      prisma.executionRequest.findMany({
        where: {
          workspaceId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        select: {
          id: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Recent active/executing/paused executions (last 20)
      prisma.executionRequest.findMany({
        where: {
          workspaceId,
          status: {
            in: ['EXECUTING', 'PENDING', 'QUEUED', 'PAUSED_FOR_APPROVAL', 'RESUMING'],
          },
        },
        select: {
          id: true,
          status: true,
          activeStep: true,
          createdAt: true,
          updatedAt: true,
          correlationId: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    // Aggregate execution counts by status
    const statusMap = executionCounts.reduce((acc, group) => {
      acc[group.status] = group._count.id;
      return acc;
    }, {});

    const active = (statusMap.EXECUTING || 0) + (statusMap.RESUMING || 0);
    const paused = statusMap.PAUSED_FOR_APPROVAL || 0;
    const queued = (statusMap.PENDING || 0) + (statusMap.QUEUED || 0);
    const failedLastHour = await prisma.executionRequest.count({
      where: {
        workspaceId,
        status: { in: ['FAILED', 'TIMED_OUT', 'CANCELLED'] },
        updatedAt: { gte: oneHourAgo },
      },
    });

    // Calculate queue metrics
    const queueDepth = queuedExecutions.length;
    let avgWaitMs = 0;
    let oldestQueuedAt = null;

    if (queueDepth > 0) {
      const totalWaitMs = queuedExecutions.reduce((sum, exec) => {
        return sum + (now.getTime() - new Date(exec.createdAt).getTime());
      }, 0);
      avgWaitMs = Math.round(totalWaitMs / queueDepth);
      oldestQueuedAt = queuedExecutions[0].createdAt;
    }

    // Format recent activity
    const formattedActivity = recentActivity.map((exec) => ({
      execution_id: exec.id,
      status: exec.status,
      active_step: exec.activeStep || null,
      created_at: exec.createdAt,
      elapsed_ms: now.getTime() - new Date(exec.createdAt).getTime(),
      correlation_id: exec.correlationId,
    }));

    return res.json({
      executions: {
        active,
        paused,
        queued,
        failed_last_hour: failedLastHour,
      },
      queue: {
        depth: queueDepth,
        avg_wait_ms: avgWaitMs,
        oldest_queued_at: oldestQueuedAt,
      },
      recent_activity: formattedActivity,
      generated_at: now.toISOString(),
    });
  } catch (err) {
    console.error('[observability/live] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch live metrics' });
  }
});
