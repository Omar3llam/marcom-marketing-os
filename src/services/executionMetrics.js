// ============================================================
// Execution Metrics — PR #14: Runtime Metrics Foundation
// ============================================================
// Append-only collector. Called fire-and-forget after every
// terminal execution transition by ExecutionLifecycleService.
//
// CONTRACT: This module is READ-ONLY from the execution system's
// perspective. It observes terminal state; it never mutates it.
// Any Prisma write here targets ONLY execution_metrics.
// ============================================================

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const TERMINAL_STATUSES = new Set(['EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED']);

/**
 * Compute and persist one ExecutionMetric row after a terminal transition.
 *
 * Timing is derived from the ExecutionTransition audit log rather than
 * wall-clock estimates, so every number is traceable to an immutable record.
 *
 * @param {string} executionId
 * @param {string} workspaceId
 * @param {string} finalStatus  — must be a terminal status string
 */
export async function recordExecutionMetric(executionId, workspaceId, finalStatus) {
  try {
    const [execution, transitions] = await Promise.all([
      prisma.executionRequest.findUnique({
        where:  { id: executionId },
        select: { createdAt: true, response: true },
      }),
      prisma.executionTransition.findMany({
        where:   { executionId },
        orderBy: { createdAt: 'asc' },
        select:  { fromStatus: true, toStatus: true, createdAt: true, actor: true },
      }),
    ]);

    if (!execution) return; // deleted between transition and metric write

    // ── Timing ──────────────────────────────────────────────
    // queueWaitMs: creation → first EXECUTING entry
    const executingEntry = transitions.find((t) => t.toStatus === 'EXECUTING');
    const terminalEntry  = transitions.find((t) => TERMINAL_STATUSES.has(t.toStatus));

    const queueWaitMs = executingEntry
      ? new Date(executingEntry.createdAt).getTime() - new Date(execution.createdAt).getTime()
      : null;

    const executionMs = (executingEntry && terminalEntry)
      ? new Date(terminalEntry.createdAt).getTime() - new Date(executingEntry.createdAt).getTime()
      : null;

    // ── Counters ─────────────────────────────────────────────
    const retryCount      = transitions.filter((t) => t.actor === 'RETRY_POLICY').length;
    const timeoutOccurred = finalStatus === 'TIMED_OUT';

    // ── Agent attribution (best-effort from response payload) ─
    let agentUsed     = null;
    let tokenEstimate = null;
    const resp = execution.response;
    if (resp && typeof resp === 'object') {
      agentUsed     = resp.agent || resp.agentUsed || null;
      tokenEstimate = typeof resp.tokenEstimate === 'number' ? resp.tokenEstimate : null;
    }

    await prisma.executionMetric.create({
      data: {
        executionId,
        workspaceId,
        queueWaitMs,
        executionMs,
        retryCount,
        timeoutOccurred,
        agentUsed,
        tokenEstimate,
        finalStatus,
      },
    });

    logger.debug(
      { executionId, finalStatus, queueWaitMs, executionMs, retryCount },
      '[executionMetrics] recorded',
    );
  } catch (err) {
    logger.error(
      { err: err.message, executionId },
      '[executionMetrics] failed to record — non-fatal',
    );
  }
}
