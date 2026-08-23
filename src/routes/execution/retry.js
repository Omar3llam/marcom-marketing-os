// ============================================================
// POST /api/execute/:id/retry — Clone failed execution + queue
// ============================================================
// Clones a failed execution into a new ExecutionRequest in QUEUED
// status. Powers the "Retry from last known good" button in the
// Operations · Incident Panel.
//
// Behavior:
//   - Only EXECUTED_FAILED / TIMED_OUT can be retried.
//   - The new ExecutionRequest carries:
//       * fresh idempotencyKey + executionId (cuid)
//       * cloned actionType, targetId, payload from the original
//       * preserved correlationId (lineage stays intact)
//       * retryMetadata: { retryOf, retriedAt, retriedBy }
//   - Created in PENDING then immediately transitioned to QUEUED
//     via the lifecycle service. That transition emits the
//     canonical audit log + SSE broadcast so the new row shows up
//     in the Live Monitor in real time.
//
// Note: queueing is not the same as executing. This endpoint
// creates a retry record and surfaces it; running it (synchronously
// like POST /meta does, or via a dedicated worker) is a separate
// concern.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';
import { ExecutionStatus, TransitionActor } from '@marcom/runtime-contracts';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE }    from '../../services/collaboration/roleScope.js';
import { loadExecutability, NOT_EXECUTABLE } from '../../services/execution/decisionEligibility.js';

/**
 * Statuses eligible for retry. Only failure terminals — retrying a
 * CANCELLED is conceptually a "re-run", and retrying a success is
 * a no-op, so both are excluded.
 */
const RETRYABLE_STATUSES = ['EXECUTED_FAILED', 'TIMED_OUT'];

// ── R11 (I70) — bounded retry chains ─────────────────────────
// `retryMetadata.retryOf` was written on every clone and read by nothing, so a
// retry of a retry of a retry was unbounded — and each link re-queues a real
// Meta mutation. The only limiter on the path was the (IP-keyed) apiLimiter.
//
// Depth is carried on the clone rather than walked backwards through the chain:
// a recursive lookup would be N queries deep on exactly the request we are
// trying to bound, and the number we need is already known at write time.
export const MAX_RETRY_DEPTH = Number(process.env.MAX_RETRY_DEPTH || 3);

/** How many retries deep an execution already is. Absent metadata ⇒ 0. */
export function retryDepthOf(execution) {
  const depth = execution?.retryMetadata?.retryDepth;
  return Number.isInteger(depth) && depth > 0 ? depth : 0;
}

export function registerRetryRoute(router) {
  // Retry re-queues a real Meta mutation — same execution tier as POST /meta.
  router.post('/:id/retry', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
    const { id: originalId } = req.params;
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      const original = await prisma.executionRequest.findUnique({
        where: { id: originalId },
        select: {
          id: true,
          workspaceId: true,
          actionType: true,
          targetId: true,
          payload: true,
          status: true,
          correlationId: true,
          decisionId: true, // R10 — carried onto the clone below
          retryMetadata: true, // R11 (I70) — carries the chain depth
        },
      });

      if (!original) {
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      if (original.workspaceId !== workspaceId) {
        logger.warn({ originalId, workspaceId, executionWorkspaceId: original.workspaceId, userId },
          '[ExecutionRouter] Retry blocked by workspace mismatch');
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      if (!RETRYABLE_STATUSES.includes(original.status)) {
        return res.status(409).json({
          error: `Execution is not in a retryable state (current: ${original.status})`,
          code: 'NOT_RETRYABLE',
          retryableStatuses: RETRYABLE_STATUSES,
        });
      }

      // R11 (I70) — refuse an unbounded retry chain. Checked after the state
      // check so an operator retrying a legitimately-failed execution gets the
      // more specific answer, and expressed as a 409 because it is a conflict
      // with the chain's history, not a malformed request.
      const depth = retryDepthOf(original);
      if (depth >= MAX_RETRY_DEPTH) {
        logger.warn({ originalId, workspaceId, userId, depth, max: MAX_RETRY_DEPTH },
          '[ExecutionRouter] Retry refused — chain depth exhausted');
        return res.status(409).json({
          error: `This execution has already been retried ${depth} times. Investigate the failure before retrying again.`,
          code: 'RETRY_DEPTH_EXCEEDED',
          retryDepth: depth,
          maxRetryDepth: MAX_RETRY_DEPTH,
        });
      }

      // ── B4-A (D2) — the decision must STILL be executable ────────────────
      //
      // meta.js has carried this check since the split; this route did not, and
      // it is the other producer of ExecutionRequest rows. A retry re-enters the
      // execution path with the ORIGINAL decisionId, and the gap between the
      // first attempt and the retry is exactly when a sweep supersedes a verdict
      // or an operator dismisses it.
      //
      // The worker checks again before the real Meta call, so no platform
      // mutation was ever landing against a terminal decision. What was landing
      // is a queued row and a 202 that reads as acceptance — the operator is
      // told the retry is under way, and only the worker log says it will not
      // be. Refusing here makes the two producers agree, and it refuses at the
      // boundary rather than downstream of it.
      //
      // Only when a decision is actually named: an execution carrying no
      // decisionId is an operator acting directly on a campaign, which has no
      // decision lifecycle to violate.
      if (original.decisionId) {
        const { executable, reason } = await loadExecutability(workspaceId, original.decisionId);
        if (!executable) {
          logger.warn({ originalId, workspaceId, userId, decisionId: original.decisionId, reason },
            '[ExecutionRouter] Retry refused — decision is not executable');
          return res.status(409).json({
            error: reason === NOT_EXECUTABLE.DISMISSED
              ? 'This decision was dismissed; a dismissed decision cannot be executed'
              : reason === NOT_EXECUTABLE.SUPERSEDED
                ? 'This decision has been superseded by a newer verdict and cannot be executed'
                : 'This decision could not be confirmed as executable',
            code: 'DECISION_NOT_EXECUTABLE',
            reason,
          });
        }
      }

      // 1. Create clone in PENDING (the canonical initial state).
      const retriedAt = new Date().toISOString();
      const newRequest = await prisma.executionRequest.create({
        data: {
          workspaceId,
          idempotencyKey: crypto.randomUUID(),
          actionType: original.actionType,
          targetId: original.targetId,
          status: ExecutionStatus.PENDING,
          payload: original.payload,
          correlationId: original.correlationId,
          // R10 (I55) — attribution travels with the retry. Re-deriving it from
          // the payload would re-open the question the original request already
          // answered; carrying the resolved column forward cannot disagree with
          // it. The workspace was proven equal above, so the id stays in scope.
          decisionId: original.decisionId,
          retryMetadata: {
            retryOf: original.id,
            retriedAt,
            retriedBy: userId,
            // R11 (I70): the chain depth travels forward so the next retry can
            // bound itself in one read instead of walking the lineage.
            retryDepth: depth + 1,
          },
        },
        select: {
          id: true,
          workspaceId: true,
          version: true,
          correlationId: true,
        },
      });

      // 2. Transition PENDING → QUEUED via the lifecycle service.
      //    Audit + SSE moment: the Live Monitor will see the new row
      //    appear with a QUEUED pill in real time.
      let updated;
      try {
        updated = await lifecycleService.transition({
          executionId: newRequest.id,
          newStatus: ExecutionStatus.QUEUED,
          expectedVersion: newRequest.version,
          actor: TransitionActor.RETRY_POLICY,
          correlationId: original.correlationId,
          metadata: {
            reason: 'manual_retry',
            auditMetadata: {
              retryOf: original.id,
              retriedBy: userId,
            },
          },
        });
      } catch (transitionErr) {
        // The record exists but couldn't be promoted. Log + surface a
        // 500 so the operator sees the failure rather than a silent
        // PENDING ghost.
        logger.error({
          originalId,
          newExecutionId: newRequest.id,
          workspaceId,
          userId,
          error: transitionErr.message,
        }, '[ExecutionRouter] Retry transition failed');
        return res.status(500).json({
          error: 'Retry created but could not be queued',
          code: 'RETRY_TRANSITION_FAILED',
          executionId: newRequest.id,
        });
      }

      logger.info({
        originalId,
        newExecutionId: newRequest.id,
        workspaceId,
        userId,
        correlationId: original.correlationId,
      }, '[ExecutionRouter] Retry queued');

      return res.status(201).json({
        executionId: newRequest.id,
        status: ExecutionStatus.QUEUED,
        retryOf: original.id,
        correlationId: original.correlationId,
        version: updated.version,
      });
    } catch (err) {
      logger.error({
        originalId,
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      }, '[ExecutionRouter] Retry failed');
      return res.status(500).json({
        error: 'Failed to retry execution',
        code: 'RETRY_ERROR',
      });
    }
  });
}
