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

const router = express.Router();

// ============================================================
// Helper: Verify workspace access
// ============================================================

async function verifyWorkspaceAccess(artifactId, userWorkspaceId) {
  const artifact = await getArtifact(artifactId);

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
router.post('/:id/approve', async (req, res) => {
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
    const existingApproval = await getApprovalStatus(artifactId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Approve
    const approval = await approveArtifact(existingApproval.id, reviewerId, feedback);

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

    res.status(error.message.includes('Unauthorized') ? 403 : 500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/artifacts/:id/reject
 * Reject artifact
 */
router.post('/:id/reject', async (req, res) => {
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
    const existingApproval = await getApprovalStatus(artifactId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Reject
    const approval = await rejectArtifact(existingApproval.id, reviewerId, reason);

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

    res.status(error.message.includes('Unauthorized') ? 403 : 500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/artifacts/:id/request-revision
 * Request revision for artifact
 */
router.post('/:id/request-revision', async (req, res) => {
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
    const existingApproval = await getApprovalStatus(artifactId);
    if (!existingApproval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Request revision
    const approval = await requestRevision(existingApproval.id, reviewerId, feedback);

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

    res.status(error.message.includes('Unauthorized') ? 403 : 500).json({
      error: error.message,
    });
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

    // Verify workspace access
    if (workspaceId !== userWorkspaceId) {
      return res.status(403).json({ error: 'Unauthorized: cannot access other workspace approvals' });
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
      error: error.message,
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

    const approval = await getApprovalStatus(artifactId);

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

    res.status(error.message.includes('Unauthorized') ? 403 : 500).json({
      error: error.message,
    });
  }
});

export default router;
