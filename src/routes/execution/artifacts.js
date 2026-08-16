// ============================================================
// Artifact Retrieval API — PR #35
// ============================================================
// HTTP endpoints for retrieving AI-generated artifacts.
// Consumed by Approval UI (PR #36) and artifact inspection tools.
//
// ENDPOINTS:
//   GET /api/execute/:executionId/artifacts
//     - List all artifacts for an execution
//     - Supports filtering by type, nodeId
//     - Returns artifact metadata + approval status
//
//   GET /api/execute/:executionId/artifacts/pending-approval
//     - List artifacts awaiting approval decision
//     - Filtered to PENDING approval status only
//     - Optimized for approval UI batch operations
//
//   GET /api/artifacts/:id
//     - Retrieve single artifact by ID
//     - Returns full content + metadata + approval status
//     - Content fetched from storage adapter (local/S3)
//
// AUTHORIZATION:
//   Workspace-scoped via firebaseAuth + contextGuard middleware
//   All queries filtered by req.workspaceId
//
// RESPONSE FORMAT:
//   {
//     artifact: { id, type, content, metadata, ... },
//     approval: { status, decision, reviewerId, ... } | null
//   }
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { getArtifact } from '../../services/artifact-storage/index.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// GET /api/execute/:executionId/artifacts
// ============================================================

export function registerArtifactsRoute(router) {
  router.get('/:executionId/artifacts', async (req, res) => {
    try {
      const { executionId } = req.params;
      const { workspaceId } = req;
      const { type, nodeId, limit = 100, offset = 0 } = req.query;
      // Clamp pagination: NaN or negatives would make Prisma throw on take/skip.
      const take = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);
      const skip = Math.max(parseInt(String(offset), 10) || 0, 0);

      // Verify execution belongs to workspace
      const execution = await prisma.executionRequest.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      if (execution.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      // Build filters
      const where = {
        workspaceId,
        executionId,
      };

      if (type) where.type = type;
      if (nodeId) where.nodeId = nodeId;

      // Query artifacts with approval status
      const artifacts = await prisma.artifact.findMany({
        where,
        include: {
          approval: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });

      // Get total count for pagination
      const total = await prisma.artifact.count({ where });

      logger.debug(
        {
          executionId,
          workspaceId,
          count: artifacts.length,
          total,
          filters: { type, nodeId },
        },
        '[artifacts] listed artifacts for execution'
      );

      res.json({
        artifacts: artifacts.map(_formatArtifactResponse),
        pagination: {
          total,
          limit: take,
          offset: skip,
          hasMore: skip + artifacts.length < total,
        },
      });
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          executionId: req.params.executionId,
        },
        '[artifacts] failed to list artifacts'
      );

      res.status(500).json({ error: 'Failed to list artifacts' });
    }
  });

  // ============================================================
  // GET /api/execute/:executionId/artifacts/pending-approval
  // ============================================================

  router.get('/:executionId/artifacts/pending-approval', async (req, res) => {
    try {
      const { executionId } = req.params;
      const { workspaceId } = req;

      // Verify execution belongs to workspace
      const execution = await prisma.executionRequest.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      if (execution.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      // Query artifacts with PENDING approval
      const artifacts = await prisma.artifact.findMany({
        where: {
          workspaceId,
          executionId,
          approval: {
            status: 'PENDING',
          },
        },
        include: {
          approval: true,
        },
        orderBy: { createdAt: 'asc' }, // Oldest first for approval queue
      });

      logger.debug(
        {
          executionId,
          workspaceId,
          pendingCount: artifacts.length,
        },
        '[artifacts] listed pending approval artifacts'
      );

      res.json({
        artifacts: artifacts.map(_formatArtifactResponse),
        count: artifacts.length,
      });
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          executionId: req.params.executionId,
        },
        '[artifacts] failed to list pending approval artifacts'
      );

      res.status(500).json({ error: 'Failed to list pending approval artifacts' });
    }
  });

  // ============================================================
  // GET /api/execute/artifacts/approved
  // ------------------------------------------------------------
  // Workspace-wide list of artifacts that have cleared human approval
  // (approval COMPLETED + decision APPROVED). Source for the Publishing
  // view, where an operator records the manual Meta publish of approved
  // creative. The per-execution list endpoints can't serve this — there is
  // no executions browser to supply an executionId — so this workspace-wide
  // listing is the surface that makes the publish action reachable.
  //
  // Gated to the execution tier (BUYER + STRATEGIST): a CLIENT (read-only)
  // has no publish action to take here. Registered BEFORE /artifacts/:id so
  // the literal 'approved' segment is not matched as an :id.
  // ============================================================
  router.get(
    '/artifacts/approved',
    requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
    async (req, res) => {
      const { workspaceId } = req;
      try {
        // Math.max guards: parseInt('-5') survives the || fallback and a
        // negative take/skip makes Prisma throw a 500.
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 200);
        const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

        // Filter on the to-one approval relation — mirrors the pending list.
        const where = {
          workspaceId,
          approval: { status: 'COMPLETED', decision: 'APPROVED' },
        };

        const [artifacts, total] = await Promise.all([
          prisma.artifact.findMany({
            where,
            include: { approval: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          prisma.artifact.count({ where }),
        ]);

        logger.debug(
          { workspaceId, count: artifacts.length, total },
          '[artifacts] listed approved artifacts'
        );

        res.json({
          artifacts: artifacts.map(_formatArtifactResponse),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + artifacts.length < total,
          },
        });
      } catch (error) {
        logger.error(
          { error: error.message, stack: error.stack, workspaceId },
          '[artifacts] failed to list approved artifacts'
        );

        res.status(500).json({ error: 'Failed to list approved artifacts' });
      }
    }
  );

  // ============================================================
  // GET /api/artifacts/:id
  // ============================================================

  router.get('/artifacts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { workspaceId } = req;

      // Verify artifact belongs to workspace
      const artifactMetadata = await prisma.artifact.findUnique({
        where: { id },
        include: {
          approval: true,
        },
      });

      if (!artifactMetadata) {
        return res.status(404).json({ error: 'Artifact not found' });
      }

      if (artifactMetadata.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Artifact not found' });
      }

      // Fetch full content from storage adapter (R9 — workspace-scoped read)
      const artifact = await getArtifact(id, workspaceId);

      if (!artifact) {
        logger.error(
          { artifactId: id, workspaceId },
          '[artifacts] artifact metadata exists but content retrieval failed'
        );

        return res.status(500).json({
          error: 'Failed to retrieve artifact content',
        });
      }

      logger.debug(
        {
          artifactId: id,
          workspaceId,
          type: artifact.type,
          size: artifact.size,
        },
        '[artifacts] retrieved artifact'
      );

      res.json({
        artifact: {
          id: artifact.id,
          executionId: artifact.executionId,
          nodeId: artifact.nodeId,
          nodeType: artifact.nodeType,
          type: artifact.type,
          capability: artifact.capability,
          provider: artifact.provider,
          version: artifact.version,
          size: artifact.size,
          content: artifact.content,
          metadata: artifact.metadata,
          createdAt: artifact.createdAt,
        },
        approval: artifactMetadata.approval || null,
      });
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          artifactId: req.params.id,
        },
        '[artifacts] failed to retrieve artifact'
      );

      res.status(500).json({ error: 'Failed to retrieve artifact' });
    }
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Format artifact response with approval status.
 * Excludes large content field from list responses.
 *
 * @private
 */
function _formatArtifactResponse(artifact) {
  return {
    id: artifact.id,
    executionId: artifact.executionId,
    nodeId: artifact.nodeId,
    nodeType: artifact.nodeType,
    type: artifact.type,
    capability: artifact.capability,
    provider: artifact.provider,
    version: artifact.version,
    size: artifact.size,
    contentHash: artifact.contentHash,
    // Exclude large 'content' field from list responses
    // Use GET /api/artifacts/:id to fetch full content
    metadata: artifact.metadata,
    createdAt: artifact.createdAt,
    approval: artifact.approval
      ? {
          id: artifact.approval.id,
          status: artifact.approval.status,
          decision: artifact.approval.decision,
          reviewerId: artifact.approval.reviewerId,
          feedback: artifact.approval.feedback,
          decisionMetadata: artifact.approval.decisionMetadata,
          approvedAt: artifact.approval.approvedAt,
          rejectedAt: artifact.approval.rejectedAt,
          createdAt: artifact.approval.createdAt,
          updatedAt: artifact.approval.updatedAt,
        }
      : null,
  };
}
