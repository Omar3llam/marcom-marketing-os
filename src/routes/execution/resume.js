// ============================================================
// POST /api/execute/:id/resume — PR #29/30: Resume Execution
// ============================================================
// Resume a paused execution from its checkpoint.
//
// FLOW (PR #29):
//   1. Verify workspace access
//   2. Load latest checkpoint
//   3. Validate checkpoint is resumable (PAUSED_FOR_APPROVAL)
//   4. Call resumeExecutionFromCheckpoint()
//   5. Return execution result
//
// FLOW (PR #30 - with decisions):
//   1. Verify workspace access
//   2. Load latest checkpoint + pending approvals
//   3. Process approval decisions from request body
//   4. Validate all approvals are decided
//   5. Resume execution with decision context
//   6. Return result with decision summary
//
// REQUEST BODY (PR #30):
//   {
//     decisions: [
//       { approvalId, decision, feedback?, decisionMetadata? }
//     ]
//   }
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
import { executeDecision } from '../../services/approval-decision/index.js';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

export function registerResumeRoute(router) {
  router.post('/:id/resume', async (req, res) => {
    try {
      const { id: executionId } = req.params;
      const { workspaceId, user } = req;
      const { decisions } = req.body || {};

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

      // PR #30: Process approval decisions if provided
      let decisionSummary = null;
      if (decisions && decisions.length > 0) {
        decisionSummary = await _processApprovalDecisions(
          executionId,
          decisions,
          user?.uid,
          workspaceId
        );

        logger.info({
          executionId,
          decisionsProcessed: decisionSummary.successful.length,
          decisionsFailed: decisionSummary.failed.length,
        }, '[execution/resume] approval decisions processed');
      }

      // Resume execution
      const result = await resumeExecutionFromCheckpoint(checkpoint.id);

      logger.info({
        executionId,
        checkpointId: checkpoint.id,
        workspaceId,
        status: result.status,
        withDecisions: !!decisionSummary,
      }, '[execution/resume] execution resumed via API');

      res.json({
        success: true,
        executionId,
        checkpointId: checkpoint.id,
        status: result.status,
        summary: result.summary,
        decisions: decisionSummary,
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

// ============================================================
// PR #30: Approval Decision Processing
// ============================================================

/**
 * Process approval decisions before resuming execution.
 *
 * @private
 * @param {string} executionId - Execution ID
 * @param {Array} decisions - Array of { approvalId, decision, feedback?, decisionMetadata? }
 * @param {string} reviewerId - User ID making decisions
 * @param {string} workspaceId - Workspace ID for authorization
 * @returns {Promise<Object>} Decision summary { successful, failed }
 */
async function _processApprovalDecisions(executionId, decisions, reviewerId, workspaceId) {
  const results = {
    successful: [],
    failed: [],
  };

  // Get all pending approvals for this execution
  const pendingApprovals = await prisma.artifactApproval.findMany({
    where: {
      workspaceId,
      status: 'PENDING',
      artifact: {
        executionId,
      },
    },
    include: {
      artifact: true,
    },
  });

  // Process each decision
  for (const decisionInput of decisions) {
    const { approvalId, decision, feedback, decisionMetadata } = decisionInput;

    try {
      // Validate approval belongs to this execution and workspace
      const approval = pendingApprovals.find(a => a.id === approvalId);
      if (!approval) {
        throw new Error(`Approval ${approvalId} not found in execution ${executionId}`);
      }

      // Execute decision
      await executeDecision(approvalId, decision, {
        reviewerId,
        feedback,
        decisionMetadata,
      });

      results.successful.push({
        approvalId,
        artifactId: approval.artifactId,
        decision,
      });

      logger.debug({
        approvalId,
        artifactId: approval.artifactId,
        decision,
      }, '[execution/resume] approval decision executed');
    } catch (error) {
      results.failed.push({
        approvalId,
        error: error.message,
      });

      logger.warn({
        approvalId,
        error: error.message,
      }, '[execution/resume] approval decision failed');
    }
  }

  // Validate all pending approvals have been decided
  const undecidedApprovals = pendingApprovals.filter(
    approval => !decisions.find(d => d.approvalId === approval.id)
  );

  if (undecidedApprovals.length > 0) {
    logger.warn({
      executionId,
      undecidedCount: undecidedApprovals.length,
      undecidedIds: undecidedApprovals.map(a => a.id),
    }, '[execution/resume] some approvals remain undecided');

    // Note: We don't block resume if some approvals are undecided
    // This allows partial decision workflows (e.g., approve some, regenerate others)
  }

  return results;
}
