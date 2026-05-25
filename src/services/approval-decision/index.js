// ============================================================
// Approval Decision Engine — PR #30
// ============================================================
// Rich decision semantics for artifact approval workflow.
// Enables selective re-execution, escalation, and revision requests.
//
// DECISION TAXONOMY:
//   APPROVED         → artifact ready for publishing
//   REJECTED         → artifact discarded, execution continues
//   REQUEST_REVISION → request changes with specific instructions
//   REGENERATE       → re-run generation node with same inputs
//   ESCALATE         → route to human reviewer for decision
//
// ARCHITECTURAL LAW:
//   rejection ≠ regeneration — different failure modes need different responses
//
// USAGE:
//   import { executeDecision, DECISION_TYPE } from './index.js'
//   await executeDecision(approvalId, DECISION_TYPE.APPROVED, { reviewerId })
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

// ============================================================
// Decision Type Constants
// ============================================================

export const DECISION_TYPE = Object.freeze({
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REQUEST_REVISION: 'REQUEST_REVISION',
  REGENERATE: 'REGENERATE',
  ESCALATE: 'ESCALATE',
});

export const APPROVAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
});

// ============================================================
// Decision Validation
// ============================================================

const DECISION_METADATA_SCHEMA = {
  [DECISION_TYPE.APPROVED]: {
    optional: ['publishTarget', 'scheduledAt'],
  },
  [DECISION_TYPE.REJECTED]: {
    required: ['rejectionReason'],
    optional: ['alternativeApproach'],
  },
  [DECISION_TYPE.REQUEST_REVISION]: {
    required: ['revisionInstructions'],
    optional: ['targetFields', 'priority'],
  },
  [DECISION_TYPE.REGENERATE]: {
    optional: ['regenerationHint', 'targetNodes', 'preserveContext'],
  },
  [DECISION_TYPE.ESCALATE]: {
    required: ['escalationReason'],
    optional: ['escalatedTo', 'urgency'],
  },
};

function validateDecisionMetadata(decisionType, metadata) {
  const schema = DECISION_METADATA_SCHEMA[decisionType];
  if (!schema) {
    throw new Error(`Invalid decision type: ${decisionType}`);
  }

  // Check if metadata is required but not provided
  if (schema.required && schema.required.length > 0) {
    if (!metadata) {
      throw new Error(`Decision ${decisionType} requires metadata with fields: ${schema.required.join(', ')}`);
    }

    const missing = schema.required.filter(field => !(field in metadata));
    if (missing.length > 0) {
      throw new Error(`Missing required metadata fields for ${decisionType}: ${missing.join(', ')}`);
    }
  }

  return true;
}

// ============================================================
// Decision Execution
// ============================================================

/**
 * Execute an approval decision with rich semantics.
 *
 * @param {string} approvalId - ArtifactApproval ID
 * @param {string} decisionType - One of DECISION_TYPE values
 * @param {Object} options - Decision options
 * @param {string} options.reviewerId - User ID making the decision
 * @param {string} options.feedback - Optional feedback/notes
 * @param {Object} options.decisionMetadata - Decision-specific metadata
 * @returns {Promise<Object>} Updated approval record
 */
export async function executeDecision(approvalId, decisionType, options = {}) {
  const { reviewerId, feedback, decisionMetadata } = options;

  // Validate decision type
  if (!Object.values(DECISION_TYPE).includes(decisionType)) {
    throw new Error(`Invalid decision type: ${decisionType}`);
  }

  // Load approval record
  const approval = await prisma.artifactApproval.findUnique({
    where: { id: approvalId },
    include: { artifact: true },
  });

  if (!approval) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  if (approval.status !== APPROVAL_STATUS.PENDING) {
    throw new Error(`Approval ${approvalId} already completed (decision: ${approval.decision})`);
  }

  // Validate metadata (after checking approval exists and is pending)
  validateDecisionMetadata(decisionType, decisionMetadata);

  // Execute decision-specific logic
  const updateData = await _executeDecisionLogic(
    decisionType,
    approval,
    { reviewerId, feedback, decisionMetadata }
  );

  // Update approval record
  const updatedApproval = await prisma.artifactApproval.update({
    where: { id: approvalId },
    data: updateData,
  });

  logger.info({
    approvalId,
    artifactId: approval.artifactId,
    decisionType,
    reviewerId,
  }, '[approval-decision] decision executed');

  return updatedApproval;
}

/**
 * Internal decision logic dispatcher.
 * Maps each decision type to its specific execution semantics.
 */
async function _executeDecisionLogic(decisionType, approval, options) {
  const { reviewerId, feedback, decisionMetadata } = options;
  const now = new Date();

  const baseUpdate = {
    status: APPROVAL_STATUS.COMPLETED,
    decision: decisionType,
    reviewerId,
    feedback,
    decisionMetadata,
    updatedAt: now,
  };

  switch (decisionType) {
    case DECISION_TYPE.APPROVED:
      return {
        ...baseUpdate,
        approvedAt: now,
      };

    case DECISION_TYPE.REJECTED:
      return {
        ...baseUpdate,
        rejectedAt: now,
      };

    case DECISION_TYPE.REQUEST_REVISION:
      // Revision requests keep status as PENDING until revision is submitted
      return {
        status: APPROVAL_STATUS.PENDING,
        decision: decisionType,
        reviewerId,
        feedback,
        decisionMetadata,
        updatedAt: now,
      };

    case DECISION_TYPE.REGENERATE:
      // Regeneration triggers new execution - mark as completed
      return {
        ...baseUpdate,
      };

    case DECISION_TYPE.ESCALATE:
      // Escalation routes to another reviewer
      const escalatedTo = decisionMetadata?.escalatedTo;
      return {
        status: APPROVAL_STATUS.PENDING, // Stays pending until escalated reviewer decides
        decision: decisionType,
        reviewerId,
        feedback,
        decisionMetadata,
        escalatedTo,
        escalatedAt: now,
        updatedAt: now,
      };

    default:
      throw new Error(`Unhandled decision type: ${decisionType}`);
  }
}

// ============================================================
// Batch Decision Execution
// ============================================================

/**
 * Execute same decision on multiple approvals (bulk approve/reject).
 *
 * @param {string[]} approvalIds - Array of ArtifactApproval IDs
 * @param {string} decisionType - Decision to apply to all
 * @param {Object} options - Decision options
 * @returns {Promise<Object>} Summary of results
 */
export async function executeBatchDecision(approvalIds, decisionType, options = {}) {
  const results = {
    successful: [],
    failed: [],
  };

  for (const approvalId of approvalIds) {
    try {
      const approval = await executeDecision(approvalId, decisionType, options);
      results.successful.push({ approvalId, artifactId: approval.artifactId });
    } catch (error) {
      results.failed.push({
        approvalId,
        error: error.message,
      });
      logger.warn({
        approvalId,
        error: error.message,
      }, '[approval-decision] batch decision failed for approval');
    }
  }

  logger.info({
    decisionType,
    total: approvalIds.length,
    successful: results.successful.length,
    failed: results.failed.length,
  }, '[approval-decision] batch decision executed');

  return results;
}

// ============================================================
// Query Helpers
// ============================================================

/**
 * Get pending approvals for workspace.
 *
 * @param {string} workspaceId - Workspace UUID
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} Pending approvals
 */
export async function getPendingApprovals(workspaceId, filters = {}) {
  const where = {
    workspaceId,
    status: APPROVAL_STATUS.PENDING,
  };

  if (filters.artifactType) {
    where.artifact = {
      type: filters.artifactType,
    };
  }

  if (filters.escalatedOnly) {
    where.decision = DECISION_TYPE.ESCALATE;
    where.escalatedTo = filters.reviewerId;
  }

  const approvals = await prisma.artifactApproval.findMany({
    where,
    include: {
      artifact: {
        select: {
          id: true,
          type: true,
          nodeType: true,
          executionId: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' }, // FIFO
  });

  return approvals;
}

/**
 * Get approval by artifact ID.
 *
 * @param {string} artifactId - Artifact ID
 * @returns {Promise<Object|null>} Approval record or null
 */
export async function getApprovalByArtifact(artifactId) {
  const approval = await prisma.artifactApproval.findUnique({
    where: { artifactId },
    include: { artifact: true },
  });

  return approval;
}

/**
 * Health check for approval decision service.
 *
 * @returns {Promise<Object>} Health status
 */
export async function healthCheck() {
  try {
    const pendingCount = await prisma.artifactApproval.count({
      where: { status: APPROVAL_STATUS.PENDING },
    });

    const escalatedCount = await prisma.artifactApproval.count({
      where: {
        decision: DECISION_TYPE.ESCALATE,
        status: APPROVAL_STATUS.PENDING,
      },
    });

    return {
      status: 'healthy',
      pendingApprovals: pendingCount,
      escalatedApprovals: escalatedCount,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ error: error.message }, '[approval-decision] health check failed');
    throw error;
  }
}
