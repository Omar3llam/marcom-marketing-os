// ============================================================
// GET /api/execute/metrics/summary — 7-day workspace metrics
// ============================================================
// Aggregates ExecutionMetric rows for the requesting workspace.
// All computation is in JS over a bounded dataset (7-day window).
//
// Response shape:
//   { total_executions, avg_queue_wait_ms, avg_execution_ms,
//     success_rate, retry_rate, timeout_rate, top_agent,
//     windowDays: 7 }
//
// READ-ONLY. Never mutates execution state.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

const WINDOW_DAYS = 7;

function avg(arr) {
  return arr.length > 0
    ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    : null;
}

function rate(count, total) {
  return total > 0 ? Math.round((count / total) * 1000) / 1000 : null;
}

function topAgent(metrics) {
  const counts = {};
  for (const m of metrics) {
    if (m.agentUsed) counts[m.agentUsed] = (counts[m.agentUsed] || 0) + 1;
  }
  const entries = Object.entries(counts);
  return entries.length > 0
    ? entries.sort((a, b) => b[1] - a[1])[0][0]
    : null;
}

export function registerMetricsSummaryRoute(router) {
  router.get('/metrics/summary', async (req, res) => {
    const workspaceId = req.workspaceId;
    const userId      = req.userId;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    try {
      const rows = await prisma.executionMetric.findMany({
        where:  { workspaceId, recordedAt: { gte: since } },
        select: {
          queueWaitMs: true,
          executionMs: true,
          retryCount:  true,
          timeoutOccurred: true,
          agentUsed:   true,
          finalStatus: true,
        },
      });

      if (rows.length === 0) {
        return res.json({
          total_executions:  0,
          avg_queue_wait_ms: null,
          avg_execution_ms:  null,
          success_rate:      null,
          retry_rate:        null,
          timeout_rate:      null,
          top_agent:         null,
          windowDays:        WINDOW_DAYS,
        });
      }

      const total      = rows.length;
      const successful = rows.filter((r) => r.finalStatus === 'EXECUTED_SUCCESS').length;
      const retried    = rows.filter((r) => r.retryCount > 0).length;
      const timedOut   = rows.filter((r) => r.timeoutOccurred).length;

      logger.debug(
        { workspaceId, userId, total, windowDays: WINDOW_DAYS },
        '[MetricsSummary] computed',
      );

      return res.json({
        total_executions:  total,
        avg_queue_wait_ms: avg(rows.map((r) => r.queueWaitMs).filter((v) => v != null)),
        avg_execution_ms:  avg(rows.map((r) => r.executionMs).filter((v) => v != null)),
        success_rate:      rate(successful, total),
        retry_rate:        rate(retried, total),
        timeout_rate:      rate(timedOut, total),
        top_agent:         topAgent(rows),
        windowDays:        WINDOW_DAYS,
      });
    } catch (err) {
      logger.error(
        { err: err.message, workspaceId },
        '[MetricsSummary] failed',
      );
      return res.status(500).json({
        error: 'Failed to fetch metrics summary',
        code:  'METRICS_SUMMARY_ERROR',
      });
    }
  });
}
