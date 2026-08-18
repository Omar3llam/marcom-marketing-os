// ============================================================
// GET /api/execute/:id/checkpoint — PR #29: Checkpoint Status
// ============================================================
// Retrieve checkpoint status for a paused execution.
//
// RESPONSE:
//   - checkpoint details (id, nodeId, status, pausedReason)
//   - timestamps (createdAt, resumedAt)
//
// USE CASE:
//   UI polls this endpoint to monitor execution state
//   before allowing user to resume
//
// AUTHORIZATION:
//   Workspace-scoped via firebaseAuth + requireWorkspace (server.js mount).
//   NOTE (R11 · E9): this line used to name contextGuard, which is mounted
//   NOWHERE. The scoping was real — it comes from req.workspaceId and the
//   per-query predicates below — but the middleware named here never ran.
//   A false claim about which control protects a route is a security defect
//   in its own right: it is what the next reader trusts instead of checking.
// ============================================================
// R11 (F26): shared Prisma client — this module used to open its own pool.
import { prisma } from '../../lib/prisma.js';
import { getLatestCheckpoint, getPausedExecutions } from '../../services/execution-checkpoint/index.js';
import { logger } from '../../utils/logger.js';


export function registerCheckpointRoute(router) {
  // GET /api/execute/:id/checkpoint - Get checkpoint for specific execution
  router.get('/:id/checkpoint', async (req, res) => {
    try {
      const { id: executionId } = req.params;
      const { workspaceId } = req;

      // Verify execution belongs to workspace
      const execution = await prisma.executionRequest.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      if (execution.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      // Get latest checkpoint (R9 — workspace-scoped read)
      const checkpoint = await getLatestCheckpoint(executionId, workspaceId);

      if (!checkpoint) {
        return res.status(404).json({ error: 'No checkpoint found for execution' });
      }

      logger.debug({
        executionId,
        checkpointId: checkpoint.id,
        status: checkpoint.status,
      }, '[execution/checkpoint] checkpoint status retrieved via API');

      res.json({
        success: true,
        checkpoint: {
          id: checkpoint.id,
          executionId: checkpoint.executionId,
          nodeId: checkpoint.nodeId,
          status: checkpoint.status,
          pausedReason: checkpoint.pausedReason,
          createdAt: checkpoint.createdAt,
          resumedAt: checkpoint.resumedAt,
        },
      });
    } catch (error) {
      logger.error({
        error: error.message,
        executionId: req.params.id,
        userId: req.user?.uid,
      }, '[execution/checkpoint] get checkpoint status failed');

      res.status(500).json({ error: 'Failed to retrieve checkpoint' });
    }
  });

  // GET /api/execute/paused - Get all paused executions for workspace
  router.get('/paused', async (req, res) => {
    try {
      const { workspaceId } = req;

      const pausedExecutions = await getPausedExecutions(workspaceId);

      logger.debug({
        workspaceId,
        count: pausedExecutions.length,
      }, '[execution/checkpoint] paused executions retrieved via API');

      res.json({
        success: true,
        executions: pausedExecutions.map(cp => ({
          executionId: cp.executionId,
          checkpointId: cp.id,
          nodeId: cp.nodeId,
          status: cp.status,
          pausedReason: cp.pausedReason,
          createdAt: cp.createdAt,
          execution: {
            id: cp.execution.id,
            actionType: cp.execution.actionType,
            targetId: cp.execution.targetId,
            status: cp.execution.status,
            createdAt: cp.execution.createdAt,
          },
        })),
      });
    } catch (error) {
      logger.error({
        error: error.message,
        workspaceId: req.workspaceId,
        userId: req.user?.uid,
      }, '[execution/checkpoint] get paused executions failed');

      res.status(500).json({ error: 'Failed to retrieve paused executions' });
    }
  });
}
