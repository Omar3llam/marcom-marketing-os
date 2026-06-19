// ============================================================
// POST /api/execute/:id/resume — Resume Execution
// ============================================================
// Thin transport layer. All business logic lives in:
//   src/services/execution/ExecutionResumeService.js
// ============================================================
import { logger } from '../../utils/logger.js';
import { resumeWithDecisions, ResumeError } from '../../services/execution/ExecutionResumeService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE }    from '../../services/collaboration/roleScope.js';

export function registerResumeRoute(router) {
  // Resuming applies approval decisions + re-executes nodes — execution tier.
  router.post('/:id/resume', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
    const { id: executionId } = req.params;
    const { workspaceId, user } = req;
    const { decisions } = req.body || {};

    try {
      const result = await resumeWithDecisions(executionId, workspaceId, decisions, user?.uid);

      logger.info({
        executionId,
        checkpointId: result.checkpointId,
        workspaceId,
        status: result.status,
        withDecisions: !!result.decisions,
        reExecuted: result.reExecuted,
      }, '[execution/resume] execution resumed via API');

      res.json({
        success: true,
        ...result,
        resumed: true,
      });
    } catch (error) {
      if (error instanceof ResumeError) {
        return res.status(error.statusCode).json(error.body);
      }

      logger.error({
        error: error.message,
        stack: error.stack,
        executionId,
        userId: user?.uid,
      }, '[execution/resume] resume execution failed');

      res.status(500).json({ error: 'Request failed' });
    }
  });
}
