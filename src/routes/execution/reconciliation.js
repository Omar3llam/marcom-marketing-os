// ============================================================
// GET /api/execute/:id/active — Reconciliation Endpoint
// ============================================================
// Backend authority for execution state.
// Used by frontend after SSE disconnect / refresh / crash.
//
// Architecture Gate Decision 1:
// - Backend reconciliation = single source of truth
// - sessionStorage = transient optimization cache only
// - SSE = best effort transport
// - This endpoint = recovery authority
//
// Contract: completely idempotent (no side effects), read-only
// authority, no implicit retries / auto-fix / hidden mutations.
// Version field enables stale detection on the client
// (incoming.version < local.version → DROP EVENT).
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';

export function registerReconciliationRoute(router) {
  router.get('/:id/active', async (req, res) => {
    const { id: executionId } = req.params;
    const { workspaceId, userId } = req.user;

    try {
      logger.debug({
        executionId,
        workspaceId,
        userId,
      }, '[ExecutionRouter] Reconciliation request');

      // Verify execution exists and belongs to workspace FIRST (security check)
      const execution = await prisma.executionRequest.findUnique({
        where: { id: executionId },
        select: { workspaceId: true },
      });

      if (!execution) {
        logger.warn({
          executionId,
          workspaceId,
          userId,
        }, '[ExecutionRouter] Execution not found');

        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      if (execution.workspaceId !== workspaceId) {
        logger.warn({
          executionId,
          workspaceId,
          executionWorkspaceId: execution.workspaceId,
          userId,
        }, '[ExecutionRouter] Workspace mismatch');

        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
        });
      }

      const state = await lifecycleService.getExecutionState(executionId);

      logger.info({
        executionId,
        workspaceId,
        userId,
        status: state.status,
        version: state.version,
        isTerminal: state.isTerminal,
        isStale: state.isStale,
      }, '[ExecutionRouter] Reconciliation successful');

      return res.json(state);
    } catch (err) {
      logger.error('[ExecutionRouter] Reconciliation failed', {
        executionId,
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      });

      return res.status(500).json({
        error: 'Failed to fetch execution state',
        code: 'RECONCILIATION_ERROR',
      });
    }
  });
}
