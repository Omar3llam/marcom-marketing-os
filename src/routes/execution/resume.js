// ============================================================
// POST /api/execute/:id/resume — PR #29: Resume Execution
// ============================================================
// Resume a paused execution from its checkpoint.
//
// FLOW:
//   1. Verify workspace access
//   2. Load latest checkpoint
//   3. Validate checkpoint is resumable (PAUSED_FOR_APPROVAL)
//   4. Call resumeExecutionFromCheckpoint()
//   5. Return execution result
//
// IDEMPOTENCY:
//   Double resume returns cached result (no re-execution)
//
// AUTHORIZATION:
//   Workspace-scoped via firebaseAuth + contextGuard middleware
// ============================================================
import { PrismaClient } from '@prisma/client';
import { resumeExecutionFromCheckpoint } from '../../services/execution-runtime/RuntimeOrchestrator.js';
import { getLatestCheckpoint } from '../../services/execution-checkpoint/index.js';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

export function registerResumeRoute(router) {
  router.post('/:id/resume', async (req, res) => {
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
        return res.status(403).json({ error: 'Unauthorized: execution belongs to different workspace' });
      }

      // Get latest checkpoint
      const checkpoint = await getLatestCheckpoint(executionId);

      if (!checkpoint) {
        return res.status(404).json({ error: 'No checkpoint found for execution' });
      }

      if (checkpoint.status !== 'PAUSED_FOR_APPROVAL') {
        return res.status(400).json({
          error: `Execution is not paused (current status: ${checkpoint.status})`,
        });
      }

      // Resume execution
      const result = await resumeExecutionFromCheckpoint(checkpoint.id);

      logger.info({
        executionId,
        checkpointId: checkpoint.id,
        workspaceId,
        status: result.status,
      }, '[execution/resume] execution resumed via API');

      res.json({
        success: true,
        executionId,
        checkpointId: checkpoint.id,
        status: result.status,
        summary: result.summary,
        resumed: true,
        alreadyResumed: result.alreadyResumed || false,
      });
    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        executionId: req.params.id,
        userId: req.user?.uid,
      }, '[execution/resume] resume execution failed');

      res.status(500).json({
        error: error.message,
      });
    }
  });
}
