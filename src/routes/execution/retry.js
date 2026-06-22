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

/**
 * Statuses eligible for retry. Only failure terminals — retrying a
 * CANCELLED is conceptually a "re-run", and retrying a success is
 * a no-op, so both are excluded.
 */
const RETRYABLE_STATUSES = ['EXECUTED_FAILED', 'TIMED_OUT'];

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
          retryMetadata: {
            retryOf: original.id,
            retriedAt,
            retriedBy: userId,
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
