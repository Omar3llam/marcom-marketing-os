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
// R11 (F26): this module used to instantiate its own PrismaClient. Four such
// clients existed across the codebase, each with its own connection pool — and
// pool exhaustion is precisely what triggered the fail-open paths R11 closes.
// One shared client, one pool.
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Raised when an approval mutation names a row that is absent, owned by
 * another workspace, or no longer PENDING. Deliberately ONE error for all
 * three: distinguishing "not yours" from "not there" would confirm the
 * existence of another tenant's row.
 */
export class ApprovalNotActionableError extends Error {
  constructor(approvalId) {
    super(`Approval not actionable: ${approvalId}`);
    this.name = 'ApprovalNotActionableError';
    this.statusCode = 409;
  }
}

/**
 * R11 (I64/I69) — the one place an approval decision is written.
 *
 * Every one of approve/reject/requestRevision used to be
 * `update({ where: { id: approvalId } })`: no workspace, and no status
 * precondition. Two consequences, both reachable from the routes:
 *
 *   - The route checked the ARTIFACT's workspace, then the service updated the
 *     APPROVAL row unscoped. Two tables; only one was asked about ownership.
 *   - A REJECTED approval could be flipped to APPROVED, repeatedly, each time
 *     overwriting reviewerId and the decision timestamp. The other approval
 *     door (executeDecision) did enforce PENDING, so the same invariant had two
 *     answers depending on which route you came through.
 *
 * Both preconditions now live in the WHERE, which makes them atomic as well as
 * unbypassable: concurrent approve/reject cannot both win, because only one can
 * move the row out of PENDING.
 */
async function decideApproval(approvalId, workspaceId, data, event) {
  if (!workspaceId) throw new Error('decideApproval: workspaceId required');
  try {
    const moved = await prisma.artifactApproval.updateMany({
      where: { id: approvalId, workspaceId, status: APPROVAL_STATUS.PENDING },
      data,
    });
    if (moved.count !== 1) throw new ApprovalNotActionableError(approvalId);

    const approval = await prisma.artifactApproval.findFirst({
      where:   { id: approvalId, workspaceId },
      include: { artifact: true },
    });

    logger.info({
      approvalId,
      workspaceId,
      artifactId: approval?.artifactId,
      reviewerId: data.reviewerId,
    }, `[artifact-approval] ${event}`);

    return approval;
  } catch (error) {
    if (error instanceof ApprovalNotActionableError) throw error;
    logger.error({
      error: error.message,
      approvalId,
      workspaceId,
      reviewerId: data.reviewerId,
    }, `[artifact-approval] failed to ${event}`);
    throw error;
  }
}

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
 * Approve artifact. Workspace-scoped and PENDING-gated inside the service.
 * @param {string} approvalId
 * @param {string} workspaceId — required; the owning workspace
 * @param {string} reviewerId
 * @param {string|null} feedback
 */
export async function approveArtifact(approvalId, workspaceId, reviewerId, feedback = null) {
  return decideApproval(approvalId, workspaceId, {
    status: APPROVAL_STATUS.APPROVED,
    reviewerId,
    feedback,
    approvedAt: new Date(),
  }, 'artifact approved');
}

/**
 * Reject artifact. Workspace-scoped and PENDING-gated inside the service.
 * @param {string} approvalId
 * @param {string} workspaceId — required; the owning workspace
 * @param {string} reviewerId
 * @param {string} reason
 */
export async function rejectArtifact(approvalId, workspaceId, reviewerId, reason) {
  return decideApproval(approvalId, workspaceId, {
    status: APPROVAL_STATUS.REJECTED,
    reviewerId,
    feedback: reason,
    rejectedAt: new Date(),
  }, 'artifact rejected');
}

/**
 * Request revision. Workspace-scoped and PENDING-gated inside the service.
 * @param {string} approvalId
 * @param {string} workspaceId — required; the owning workspace
 * @param {string} reviewerId
 * @param {string} feedback
 */
export async function requestRevision(approvalId, workspaceId, reviewerId, feedback) {
  return decideApproval(approvalId, workspaceId, {
    status: APPROVAL_STATUS.REVISION_REQUESTED,
    reviewerId,
    feedback,
  }, 'revision requested');
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
