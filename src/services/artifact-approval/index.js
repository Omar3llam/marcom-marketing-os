// ============================================================
// Artifact Approval Service — Human-in-the-loop review
// ============================================================
// Manages approval workflow for AI-generated artifacts.
//
// Phase 1: Approval tracking (no runtime pause/resume yet)
// Phase 2: Interruptible execution (coming in PR #29)
//
// APPROVAL FLOW:
//   1. Artifact generated → approval request created (PENDING)
//   2. Human reviews → approve/reject/request revision
//   3. Status updated → timestamp recorded
//
// APPROVAL GRANULARITY:
//   Per artifact (not per execution), enabling fine-grained control
//
// CONFIGURATION:
//   APPROVAL_REQUIRED: which artifact types need approval
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

// ============================================================
// Configuration
// ============================================================

export const APPROVAL_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
};

// Which artifact types require approval before publishing
export const APPROVAL_REQUIRED = {
  hook: true,
  caption: true,
  visual_brief: false,      // Visual briefs are reference material
  audience_hypothesis: false, // Hypotheses are analytical
  angle: true,              // Angles affect messaging
};

// ============================================================
// Core Operations
// ============================================================

/**
 * Check if artifact type requires approval
 */
export function artifactRequiresApproval(artifactType) {
  return APPROVAL_REQUIRED[artifactType] === true;
}

/**
 * Create approval request for artifact
 */
export async function createApprovalRequest(artifactId, workspaceId) {
  try {
    const approval = await prisma.artifactApproval.create({
      data: {
        artifactId,
        workspaceId,
        status: APPROVAL_STATUS.PENDING,
      },
    });

    logger.debug({
      approvalId: approval.id,
      artifactId,
      workspaceId,
    }, '[artifact-approval] approval request created');

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId,
      workspaceId,
    }, '[artifact-approval] failed to create approval request');
    throw error;
  }
}

/**
 * Approve artifact
 */
export async function approveArtifact(approvalId, reviewerId, feedback = null) {
  try {
    const approval = await prisma.artifactApproval.update({
      where: { id: approvalId },
      data: {
        status: APPROVAL_STATUS.APPROVED,
        reviewerId,
        feedback,
        approvedAt: new Date(),
      },
      include: {
        artifact: true,
      },
    });

    logger.info({
      approvalId,
      artifactId: approval.artifactId,
      reviewerId,
    }, '[artifact-approval] artifact approved');

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      approvalId,
      reviewerId,
    }, '[artifact-approval] failed to approve artifact');
    throw error;
  }
}

/**
 * Reject artifact
 */
export async function rejectArtifact(approvalId, reviewerId, reason) {
  try {
    const approval = await prisma.artifactApproval.update({
      where: { id: approvalId },
      data: {
        status: APPROVAL_STATUS.REJECTED,
        reviewerId,
        feedback: reason,
        rejectedAt: new Date(),
      },
      include: {
        artifact: true,
      },
    });

    logger.info({
      approvalId,
      artifactId: approval.artifactId,
      reviewerId,
      reason,
    }, '[artifact-approval] artifact rejected');

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      approvalId,
      reviewerId,
    }, '[artifact-approval] failed to reject artifact');
    throw error;
  }
}

/**
 * Request revision for artifact
 */
export async function requestRevision(approvalId, reviewerId, feedback) {
  try {
    const approval = await prisma.artifactApproval.update({
      where: { id: approvalId },
      data: {
        status: APPROVAL_STATUS.REVISION_REQUESTED,
        reviewerId,
        feedback,
      },
      include: {
        artifact: true,
      },
    });

    logger.info({
      approvalId,
      artifactId: approval.artifactId,
      reviewerId,
      feedback,
    }, '[artifact-approval] revision requested');

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      approvalId,
      reviewerId,
    }, '[artifact-approval] failed to request revision');
    throw error;
  }
}

/**
 * Get pending approvals for workspace
 */
export async function getPendingApprovals(workspaceId, filters = {}) {
  try {
    const where = {
      workspaceId,
      status: APPROVAL_STATUS.PENDING,
      ...filters,
    };

    const approvals = await prisma.artifactApproval.findMany({
      where,
      include: {
        artifact: {
          select: {
            id: true,
            type: true,
            capability: true,
            provider: true,
            nodeId: true,
            nodeType: true,
            executionId: true,
            createdAt: true,
            content: true, // Include for preview
            metadata: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc', // Oldest first (FIFO)
      },
    });

    logger.debug({
      workspaceId,
      count: approvals.length,
      filters,
    }, '[artifact-approval] retrieved pending approvals');

    return approvals;
  } catch (error) {
    logger.error({
      error: error.message,
      workspaceId,
    }, '[artifact-approval] failed to retrieve pending approvals');
    throw error;
  }
}

/**
 * Get approval status for artifact, within a workspace.
 *
 * R9 (I40) — scoped. ArtifactApproval carries its own workspaceId, and this read
 * keyed only on artifactId; the routes then approved/rejected whatever row came
 * back. The artifact-side check the routes already ran does not cover this row:
 * they are two tables, and only one of them was being asked about ownership.
 *
 * @param {string} artifactId
 * @param {string} workspaceId — required; the owning workspace
 */
export async function getApprovalStatus(artifactId, workspaceId) {
  if (!workspaceId) throw new Error('getApprovalStatus: workspaceId required');
  try {
    const approval = await prisma.artifactApproval.findFirst({
      where: { artifactId, workspaceId },
      include: {
        artifact: {
          select: {
            id: true,
            type: true,
            capability: true,
            nodeId: true,
            executionId: true,
          },
        },
      },
    });

    if (!approval) {
      logger.debug({ artifactId }, '[artifact-approval] no approval found');
      return null;
    }

    logger.debug({
      artifactId,
      status: approval.status,
    }, '[artifact-approval] approval status retrieved');

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId,
    }, '[artifact-approval] failed to retrieve approval status');
    throw error;
  }
}

/**
 * Get approval by ID, within a workspace.
 * R9 (I40) — see getApprovalStatus. Absent-or-foreign is one outcome here (the
 * pre-existing throw), so a cross-workspace id is indistinguishable from a
 * missing one, which is the intended answer.
 *
 * @param {string} approvalId
 * @param {string} workspaceId — required; the owning workspace
 */
export async function getApproval(approvalId, workspaceId) {
  if (!workspaceId) throw new Error('getApproval: workspaceId required');
  try {
    const approval = await prisma.artifactApproval.findFirst({
      where: { id: approvalId, workspaceId },
      include: {
        artifact: true,
      },
    });

    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    return approval;
  } catch (error) {
    logger.error({
      error: error.message,
      approvalId,
    }, '[artifact-approval] failed to retrieve approval');
    throw error;
  }
}

/**
 * Health check
 */
export async function healthCheck() {
  try {
    await prisma.artifactApproval.findFirst();
    return { healthy: true };
  } catch (error) {
    logger.error({ error: error.message }, '[artifact-approval] health check failed');
    return { healthy: false, error: error.message };
  }
}
