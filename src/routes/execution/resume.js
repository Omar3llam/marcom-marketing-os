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
import { resumeExecutionFromCheckpoint, reExecuteNodes } from '../../services/execution-runtime/RuntimeOrchestrator.js';
import { getLatestCheckpoint } from '../../services/execution-checkpoint/index.js';
import { executeDecision, DECISION_TYPE } from '../../services/approval-decision/index.js';
import { validateStructuredFeedback } from '../../types/feedbackTypes.js';
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
      let nodesToReExecute = [];
      let decisionContext = {};

      if (decisions && decisions.length > 0) {
        const processResult = await _processApprovalDecisions(
          executionId,
          decisions,
          user?.uid,
          workspaceId
        );

        decisionSummary = processResult.summary;

        // PR #31: Extract nodes to re-execute from REGENERATE/REQUEST_REVISION decisions
        nodesToReExecute = processResult.nodesToReExecute || [];
        decisionContext = processResult.decisionContext || {};

        logger.info({
          executionId,
          decisionsProcessed: decisionSummary.successful.length,
          decisionsFailed: decisionSummary.failed.length,
          nodesToReExecute: nodesToReExecute.length,
        }, '[execution/resume] approval decisions processed');
      }

      // PR #31: Resume with selective re-execution if needed
      let result;
      if (nodesToReExecute.length > 0) {
        result = await reExecuteNodes(checkpoint.id, nodesToReExecute, decisionContext);
      } else {
        result = await resumeExecutionFromCheckpoint(checkpoint.id);
      }

      logger.info({
        executionId,
        checkpointId: checkpoint.id,
        workspaceId,
        status: result.status,
        withDecisions: !!decisionSummary,
        reExecuted: result.reExecuted || false,
      }, '[execution/resume] execution resumed via API');

      res.json({
        success: true,
        executionId,
        checkpointId: checkpoint.id,
        status: result.status,
        summary: result.summary,
        decisions: decisionSummary,
        resumed: true,
        reExecuted: result.reExecuted || false,
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
 * @returns {Promise<Object>} { summary: { successful, failed }, nodesToReExecute, decisionContext }
 */
async function _processApprovalDecisions(executionId, decisions, reviewerId, workspaceId) {
  const results = {
    successful: [],
    failed: [],
  };

  // PR #31: Track nodes that need re-execution
  const nodesToReExecute = [];
  const decisionContext = {
    feedback: {},
    revisionInstructions: {},
    regenerationHints: {},
    // PR #33: Structured feedback fields
    feedbackType: {},      // nodeId → FEEDBACK_TYPE
    severity: {},          // nodeId → SEVERITY
    preserveAspects: {},   // nodeId → string[]
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
    const {
      approvalId,
      decision,
      feedback,
      decisionMetadata,
    } = decisionInput;

    // PR #33/37: Extract structured feedback fields from decisionMetadata
    const feedbackType = decisionMetadata?.feedbackType || null;
    const severity = decisionMetadata?.severity || null;
    const preserveAspects = decisionMetadata?.preserveAspects || [];

    try {
      // PR #33: Validate structured feedback if provided
      const validationResult = validateStructuredFeedback({
        feedbackType,
        severity,
        preserveAspects,
      });

      if (!validationResult.valid) {
        throw new Error(`Invalid structured feedback: ${validationResult.errors.join(', ')}`);
      }

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

      // PR #37: Capture decision analytics
      await _captureDecisionAnalytics({
        approvalId,
        artifactId: approval.artifactId,
        executionId,
        workspaceId,
        decision,
        feedback,
        feedbackType,
        severity,
        preserveAspects,
        artifact: approval.artifact,
        reviewerId,
      });

      results.successful.push({
        approvalId,
        artifactId: approval.artifactId,
        decision,
      });

      // PR #31: Track nodes for re-execution
      if (decision === DECISION_TYPE.REGENERATE || decision === DECISION_TYPE.REQUEST_REVISION) {
        const nodeId = approval.artifact.nodeId;

        if (!nodesToReExecute.includes(nodeId)) {
          nodesToReExecute.push(nodeId);
        }

        // Store decision context for this node (PR #31)
        if (feedback) {
          decisionContext.feedback[nodeId] = feedback;
        }

        if (decision === DECISION_TYPE.REQUEST_REVISION && decisionMetadata?.revisionInstructions) {
          decisionContext.revisionInstructions[nodeId] = decisionMetadata.revisionInstructions;
        }

        if (decision === DECISION_TYPE.REGENERATE && decisionMetadata?.regenerationHint) {
          decisionContext.regenerationHints[nodeId] = decisionMetadata.regenerationHint;
        }

        // PR #33: Store structured feedback fields
        if (feedbackType) {
          decisionContext.feedbackType[nodeId] = feedbackType;
        }

        if (severity) {
          decisionContext.severity[nodeId] = severity;
        }

        if (preserveAspects && preserveAspects.length > 0) {
          decisionContext.preserveAspects[nodeId] = preserveAspects;
        }

        logger.info({
          nodeId,
          decision,
          artifactId: approval.artifactId,
          feedbackType,
          severity,
          preserveAspects: preserveAspects?.length || 0,
        }, '[execution/resume] node marked for re-execution with structured feedback');
      }

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

  return {
    summary: results,
    nodesToReExecute,
    decisionContext,
  };
}

// ============================================================
// PR #37: Decision Analytics Capture
// ============================================================

/**
 * Capture approval decision for analytics and intelligence learning.
 *
 * @private
 * @param {Object} params - Decision data
 * @param {string} params.approvalId - Approval ID
 * @param {string} params.artifactId - Artifact ID
 * @param {string} params.executionId - Execution ID
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} params.decision - Decision type (APPROVED, REJECTED, etc.)
 * @param {string} [params.feedback] - Free-form feedback
 * @param {string} [params.feedbackType] - Structured feedback type
 * @param {string} [params.severity] - Severity level
 * @param {string[]} [params.preserveAspects] - Aspects to preserve
 * @param {Object} params.artifact - Artifact record (for provider attribution)
 * @param {string} params.reviewerId - User ID making decision
 */
async function _captureDecisionAnalytics({
  approvalId,
  artifactId,
  executionId,
  workspaceId,
  decision,
  feedback,
  feedbackType,
  severity,
  preserveAspects,
  artifact,
  reviewerId,
}) {
  try {
    // Extract provider attribution from artifact
    const provider = artifact?.provider || null;
    const capability = artifact?.capability || null;
    const model = artifact?.metadata?.model || null;

    // Create ApprovalDecision record
    await prisma.approvalDecision.create({
      data: {
        approvalId,
        artifactId,
        executionId,
        workspaceId,
        decision,
        feedback: feedback || null,
        feedbackType: feedbackType || null,
        severity: severity || null,
        preserveAspects: preserveAspects || [],
        provider,
        capability,
        model,
        reviewerId,
      },
    });

    logger.debug({
      approvalId,
      artifactId,
      decision,
      provider,
      capability,
      feedbackType,
      severity,
    }, '[execution/resume] decision analytics captured');
  } catch (error) {
    // Log error but don't fail resume operation
    logger.error({
      error: error.message,
      approvalId,
      artifactId,
    }, '[execution/resume] failed to capture decision analytics');
  }
}
