// ============================================================
// MARCOM / Lumi — Recent Failure Log
// GET /api/observability/failures
// ============================================================
// Shows recent failed/timed-out/cancelled executions from the
// last 24 hours. Includes active step, provider, error context,
// and failure timestamp. Read-only, workspace-scoped.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const failuresRouter = Router();

// ─────────────────────────────────────────────────────────────
// GET /api/observability/failures
// ─────────────────────────────────────────────────────────────
failuresRouter.get('/failures', async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch failed executions from last 24h
    const failedExecutions = await prisma.executionRequest.findMany({
      where: {
        workspaceId,
        status: { in: ['FAILED', 'TIMED_OUT', 'CANCELLED'] },
        updatedAt: { gte: twentyFourHoursAgo },
      },
      select: {
        id: true,
        status: true,
        activeStep: true,
        correlationId: true,
        updatedAt: true,
        payload: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50, // Last 50 failures
    });

    // Fetch corresponding metrics to get provider info
    const executionIds = failedExecutions.map((e) => e.id);
    const metrics = await prisma.executionMetric.findMany({
      where: {
        executionId: { in: executionIds },
        workspaceId,
      },
      select: {
        executionId: true,
        agentUsed: true,
        retryCount: true,
      },
    });

    // Create a map of execution ID -> metric data
    const metricsMap = metrics.reduce((acc, m) => {
      acc[m.executionId] = m;
      return acc;
    }, {});

    // Fetch latest transition for each failed execution to get error context
    const transitions = await prisma.executionTransition.findMany({
      where: {
        executionId: { in: executionIds },
        workspaceId,
        toStatus: { in: ['FAILED', 'TIMED_OUT', 'CANCELLED'] },
      },
      select: {
        executionId: true,
        reason: true,
        toStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Create a map of execution ID -> latest transition
    const transitionMap = {};
    transitions.forEach((t) => {
      if (!transitionMap[t.executionId]) {
        transitionMap[t.executionId] = t;
      }
    });

    // Format failures
    const failures = failedExecutions.map((exec) => {
      const metric = metricsMap[exec.id];
      const transition = transitionMap[exec.id];

      return {
        execution_id: exec.id,
        status: exec.status,
        active_step: exec.activeStep || 'unknown',
        provider: metric?.agentUsed || 'unknown',
        retry_count: metric?.retryCount || 0,
        failed_at: exec.updatedAt,
        error_context: transition?.reason || 'No error details available',
        correlation_id: exec.correlationId,
      };
    });

    return res.json({
      window: 'last_24h',
      failures,
      count: failures.length,
      generated_at: now.toISOString(),
    });
  } catch (err) {
    console.error('[observability/failures] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch failure log' });
  }
});
