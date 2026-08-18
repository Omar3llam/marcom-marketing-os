// ============================================================
// Artifact Approval Routes — Human-in-the-loop review API
// ============================================================
// REST endpoints for approval workflow.
//
// ROUTES:
//   POST   /api/artifacts/:id/approve
//   POST   /api/artifacts/:id/reject
//   POST   /api/artifacts/:id/request-revision
//   GET    /api/workspaces/:id/approvals/pending
//   GET    /api/artifacts/:id/approval-status
//
// AUTHENTICATION:
//   All routes require Firebase auth (req.user, req.workspaceId)
//
// AUTHORIZATION:
//   Workspace-scoped (can only approve artifacts in your workspace)
// ============================================================
import express from 'express';
import {
  approveArtifact,
  rejectArtifact,
  requestRevision,
  getPendingApprovals,
  getApprovalStatus,
} from '../services/artifact-approval/index.js';
import { getArtifact } from '../services/artifact-storage/index.js';
import { logger } from '../utils/logger.js';
import { requireCollabRole } from '../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../services/collaboration/roleScope.js';

const router = express.Router();

// Approving / rejecting / requesting revision of an AI-generated artifact is an
// approval action — STRATEGIST-only, mirroring canApprove and the plan-approval
// gate. A read-only CLIENT or an execution-only BUYER seat cannot decide artifacts.
const requireApprover = requireCollabRole(WORKSPACE_ROLE.STRATEGIST);

// R11 (I72/I73) — every handler in this file used to answer failures with
// `res.json({ error: error.message })`, which walks straight past the global
// handler's production suppression and hands the caller raw Prisma constraint
// text. Each distinct outcome keeps its own status; only the wording is
// generic. The detail is already in the logger.error line at each call site.
function respondWithError(res, error) {
  if (error?.name === 'ApprovalNotActionableError') {
    // Absent, foreign, or no longer PENDING — deliberately one answer, so the
    // response cannot be used to probe for another tenant's approval ids.
    return res.status(409).json({
      error:   'ApprovalNotActionable',
      message: 'That approval is no longer awaiting a decision.',
    });
  }
  if (typeof error?.message === 'string' && error.message.includes('Unauthorized')) {
    return res.status(403).json({ error: 'Forbidden', message: 'You do not have access to that artifact.' });
  }
  return res.status(500).json({ error: 'InternalError', message: 'Request failed.' });
}

// ============================================================
// Helper: Verify workspace access
// ============================================================

async function verifyWorkspaceAccess(artifactId, userWorkspaceId) {
  // R9 (I40) — the scope is now an argument to the resolver. The ownership
  // comparison below is retained (it costs nothing and states the rule at the
  // point the route depends on it), but it is no longer the ONLY thing standing
  // between a foreign artifact id and this artifact's bytes.
  const artifact = await getArtifact(artifactId, userWorkspaceId);

  if (!artifact) {
    throw new Error('Artifact not found');
  }

  if (artifact.workspaceId !== userWorkspaceId) {
    throw new Error('Unauthorized: artifact belongs to different workspace');
  }

  return artifact;
}

// ============================================================
// Routes
// ============================================================

/**
 * POST /api/artifacts/:id/approve
 * Approve artifact
 */
router.post('/:id/approve', requireApprover, async (req, res) => {
  try {
    const { id: artifactId } = req.params;
    const { feedback } = req.body;
    const reviewerId = req.user?.uid;
    const workspaceId = req.workspaceId;

    if (!reviewerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!workspaceId) {
      return res.status(401).json({ error: 'Workspace required' });
    }

    // Verify workspace access
    await verifyWorkspaceAccess(artifactId, workspaceId);

    // Get approval by artifactId
    const existingApproval = await getApprovalStatus(artifactId, workspaceId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Approve
    // R11 (I64): workspaceId is an argument to the service, not a check this
    // caller performed on its behalf.
    const approval = await approveArtifact(existingApproval.id, workspaceId, reviewerId, feedback);

    logger.info({
      artifactId,
      approvalId: approval.id,
      reviewerId,
      workspaceId,
    }, '[artifact-approval] artifact approved via API');

    res.json({
      success: true,
      approval: {
        id: approval.id,
        artifactId: approval.artifactId,
        status: approval.status,
        reviewerId: approval.reviewerId,
        feedback: approval.feedback,
        approvedAt: approval.approvedAt,
      },
    });
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId: req.params.id,
      userId: req.user?.uid,
    }, '[artifact-approval] approve artifact failed');

    respondWithError(res, error);
  }
});

/**
 * POST /api/artifacts/:id/reject
 * Reject artifact
 */
router.post('/:id/reject', requireApprover, async (req, res) => {
  try {
    const { id: artifactId } = req.params;
    const { reason } = req.body;
    const reviewerId = req.user?.uid;
    const workspaceId = req.workspaceId;

    if (!reviewerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!workspaceId) {
      return res.status(401).json({ error: 'Workspace required' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason required' });
    }

    // Verify workspace access
    await verifyWorkspaceAccess(artifactId, workspaceId);

    // Get approval by artifactId
    const existingApproval = await getApprovalStatus(artifactId, workspaceId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Reject
    const approval = await rejectArtifact(existingApproval.id, workspaceId, reviewerId, reason);

    logger.info({
      artifactId,
      approvalId: approval.id,
      reviewerId,
      workspaceId,
      reason,
    }, '[artifact-approval] artifact rejected via API');

    res.json({
      success: true,
      approval: {
        id: approval.id,
        artifactId: approval.artifactId,
        status: approval.status,
        reviewerId: approval.reviewerId,
        feedback: approval.feedback,
        rejectedAt: approval.rejectedAt,
      },
    });
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId: req.params.id,
      userId: req.user?.uid,
    }, '[artifact-approval] reject artifact failed');

    respondWithError(res, error);
  }
});

/**
 * POST /api/artifacts/:id/request-revision
 * Request revision for artifact
 */
router.post('/:id/request-revision', requireApprover, async (req, res) => {
  try {
    const { id: artifactId } = req.params;
    const { feedback } = req.body;
    const reviewerId = req.user?.uid;
    const workspaceId = req.workspaceId;

    if (!reviewerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!workspaceId) {
      return res.status(401).json({ error: 'Workspace required' });
    }

    if (!feedback) {
      return res.status(400).json({ error: 'Feedback required for revision request' });
    }

    // Verify workspace access
    await verifyWorkspaceAccess(artifactId, workspaceId);

    // Get approval by artifactId
    const existingApproval = await getApprovalStatus(artifactId, workspaceId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Request revision
    const approval = await requestRevision(existingApproval.id, workspaceId, reviewerId, feedback);

    logger.info({
      artifactId,
      approvalId: approval.id,
      reviewerId,
      workspaceId,
      feedback,
    }, '[artifact-approval] revision requested via API');

    res.json({
      success: true,
      approval: {
        id: approval.id,
        artifactId: approval.artifactId,
        status: approval.status,
        reviewerId: approval.reviewerId,
        feedback: approval.feedback,
      },
    });
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId: req.params.id,
      userId: req.user?.uid,
    }, '[artifact-approval] request revision failed');

    respondWithError(res, error);
  }
});

/**
 * GET /api/workspaces/:id/approvals/pending
 * Get pending approvals for workspace
 */
router.get('/workspaces/:id/approvals/pending', async (req, res) => {
  try {
    const { id: workspaceId } = req.params;
    const userWorkspaceId = req.workspaceId;

    if (!userWorkspaceId) {
      return res.status(401).json({ error: 'Workspace required' });
    }

    // Verify workspace access. 404 (not 403) — never confirm the existence of
    // another workspace's approvals to a caller who doesn't own them.
    if (workspaceId !== userWorkspaceId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const approvals = await getPendingApprovals(workspaceId);

    logger.debug({
      workspaceId,
      count: approvals.length,
    }, '[artifact-approval] pending approvals retrieved via API');

    res.json({
      success: true,
      approvals: approvals.map(a => ({
        id: a.id,
        artifactId: a.artifactId,
        status: a.status,
        createdAt: a.createdAt,
        artifact: {
          id: a.artifact.id,
          type: a.artifact.type,
          capability: a.artifact.capability,
          provider: a.artifact.provider,
          nodeId: a.artifact.nodeId,
          nodeType: a.artifact.nodeType,
          executionId: a.artifact.executionId,
          content: a.artifact.content,
          metadata: a.artifact.metadata,
          createdAt: a.artifact.createdAt,
        },
      })),
    });
  } catch (error) {
    logger.error({
      error: error.message,
      workspaceId: req.params.id,
      userId: req.user?.uid,
    }, '[artifact-approval] get pending approvals failed');

    res.status(500).json({
      error: 'Failed to load pending approvals',
    });
  }
});

/**
 * GET /api/artifacts/:id/approval-status
 * Get approval status for artifact
 */
router.get('/:id/approval-status', async (req, res) => {
  try {
    const { id: artifactId } = req.params;
    const workspaceId = req.workspaceId;

    if (!workspaceId) {
      return res.status(401).json({ error: 'Workspace required' });
    }

    // Verify workspace access
    await verifyWorkspaceAccess(artifactId, workspaceId);

    const approval = await getApprovalStatus(artifactId, workspaceId);

    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    logger.debug({
      artifactId,
      status: approval.status,
    }, '[artifact-approval] approval status retrieved via API');

    res.json({
      success: true,
      approval: {
        id: approval.id,
        artifactId: approval.artifactId,
        status: approval.status,
        reviewerId: approval.reviewerId,
        feedback: approval.feedback,
        approvedAt: approval.approvedAt,
        rejectedAt: approval.rejectedAt,
        createdAt: approval.createdAt,
      },
    });
  } catch (error) {
    logger.error({
      error: error.message,
      artifactId: req.params.id,
      userId: req.user?.uid,
    }, '[artifact-approval] get approval status failed');

    respondWithError(res, error);
  }
});

export default router;
