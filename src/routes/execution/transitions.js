// ============================================================
// GET /api/execute/:id/transitions — Transition timeline
// ============================================================
// Returns the ordered transition chain for an execution.
// Powers Operations · Execution Timeline.
//
// Response: {
//   execution: { id, actionType, status, version, correlationId, ... },
//   transitions: [{ id, fromStatus, toStatus, actor, previousVersion,
//     newVersion, reason, metadata, correlationId, createdAt }, ...]
// }
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { loadExecutionForWorkspace } from './_helpers.js';

export function registerTransitionsRoute(router) {
  router.get('/:id/transitions', async (req, res) => {
    const { id: executionId } = req.params;
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      const { execution } = await loadExecutionForWorkspace(executionId, workspaceId);

      if (!execution) {
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      const transitions = await prisma.executionTransition.findMany({
        where: { executionId, workspaceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actor: true,
          previousVersion: true,
          newVersion: true,
          reason: true,
          metadata: true,
          correlationId: true,
          createdAt: true,
        },
      });

      logger.debug({
        executionId,
        workspaceId,
        userId,
        transitionCount: transitions.length,
      }, '[ExecutionRouter] Transitions fetched');

      return res.json({ execution, transitions });
    } catch (err) {
      logger.error('[ExecutionRouter] Transitions fetch failed', {
        executionId,
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({
        error: 'Failed to fetch transitions',
        code: 'TRANSITIONS_ERROR',
      });
    }
  });
}
