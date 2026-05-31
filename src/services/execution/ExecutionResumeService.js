// ============================================================
// Execution Resume Service
// Business logic extracted from routes/execution/resume.js
//
// ARCHITECTURAL LAW 1: No direct prisma.executionRequest.update()
// Status transitions MUST go through ExecutionLifecycleService.transition()
// The actual transitions here are delegated to RuntimeOrchestrator.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { resumeExecutionFromCheckpoint, reExecuteNodes } from '../execution-runtime/RuntimeOrchestrator.js';
import { getLatestCheckpoint } from '../execution-checkpoint/index.js';
import { executeDecision, DECISION_TYPE } from '../approval-decision/index.js';
import { validateStructuredFeedback } from '../../types/feedbackTypes.js';
import { logger } from '../../utils/logger.js';

export class ResumeError extends Error {
  constructor(statusCode, body) {
    super(body.error || 'Resume error');
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Orchestrate a full execution resume, optionally processing approval decisions first.
 *
 * @param {string} executionId
 * @param {string} workspaceId - Workspace making the request (for ownership check)
 * @param {Array|undefined} decisions - Approval decisions from request body
 * @param {string|undefined} reviewerId - Firebase uid of the reviewer
 * @returns {Promise<object>} Result payload (no statusCode — throws ResumeError for user errors)
 * @throws {ResumeError} 404/403/400 for user-facing validation failures
 */
export async function resumeWithDecisions(executionId, workspaceId, decisions, reviewerId) {
  // Verify execution exists and belongs to this workspace
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
  });

  if (!execution) {
    throw new ResumeError(404, { error: 'Execution not found' });
  }

  if (execution.workspaceId !== workspaceId) {
    throw new ResumeError(403, { error: 'Unauthorized: execution belongs to different workspace' });
  }

  // Load latest checkpoint and validate it is resumable
  const checkpoint = await getLatestCheckpoint(executionId);

  if (!checkpoint) {
    throw new ResumeError(404, { error: 'No checkpoint found for execution' });
  }

  if (checkpoint.status !== 'PAUSED_FOR_APPROVAL') {
    throw new ResumeError(400, {
      error: `Execution is not paused (current status: ${checkpoint.status})`,
    });
  }

  // Process approval decisions if provided (PR #30)
  let decisionSummary = null;
  let nodesToReExecute = [];
  let decisionContext = {};

  if (decisions && decisions.length > 0) {
    const processResult = await _processApprovalDecisions(
      executionId,
      decisions,
      reviewerId,
      workspaceId,
    );

    decisionSummary = processResult.summary;
    nodesToReExecute = processResult.nodesToReExecute || [];
    decisionContext = processResult.decisionContext || {};

    logger.info({
      executionId,
      decisionsProcessed: decisionSummary.successful.length,
      decisionsFailed: decisionSummary.failed.length,
      nodesToReExecute: nodesToReExecute.length,
    }, '[execution/resume] approval decisions processed');
  }

  // Resume with selective re-execution if REGENERATE/REQUEST_REVISION decisions exist (PR #31)
  const result = nodesToReExecute.length > 0
    ? await reExecuteNodes(checkpoint.id, nodesToReExecute, decisionContext)
    : await resumeExecutionFromCheckpoint(checkpoint.id);

  return {
    executionId,
    checkpointId: checkpoint.id,
    status: result.status,
    summary: result.summary,
    decisions: decisionSummary,
    reExecuted: result.reExecuted || false,
    alreadyResumed: result.alreadyResumed || false,
  };
}

// ============================================================
// PR #30: Approval Decision Processing
// ============================================================

/**
 * Process approval decisions before resuming execution.
 *
 * @private
 * @param {string} executionId
 * @param {Array} decisions - Array of { approvalId, decision, feedback?, decisionMetadata? }
 * @param {string} reviewerId - User making decisions
 * @param {string} workspaceId - For ownership check on pending approvals
 * @returns {Promise<object>} { summary: { successful, failed }, nodesToReExecute, decisionContext }
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

  // Warn if some approvals remain undecided (non-blocking — partial decisions are allowed)
  const undecidedApprovals = pendingApprovals.filter(
    approval => !decisions.find(d => d.approvalId === approval.id)
  );

  if (undecidedApprovals.length > 0) {
    logger.warn({
      executionId,
      undecidedCount: undecidedApprovals.length,
      undecidedIds: undecidedApprovals.map(a => a.id),
    }, '[execution/resume] some approvals remain undecided');
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
 * Fire-and-forget: failures are logged but never surface to the caller.
 *
 * @private
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
    const provider   = artifact?.provider   || null;
    const capability = artifact?.capability || null;
    const model      = artifact?.metadata?.model || null;

    await prisma.approvalDecision.create({
      data: {
        approvalId,
        artifactId,
        executionId,
        workspaceId,
        decision,
        feedback:        feedback       || null,
        feedbackType:    feedbackType   || null,
        severity:        severity       || null,
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
    logger.error({
      error: error.message,
      approvalId,
      artifactId,
    }, '[execution/resume] failed to capture decision analytics');
  }
}
