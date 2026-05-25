// ============================================================
// Artifact Retrieval API Tests — PR #35
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock prisma before any imports that use it
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    artifact: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    artifactApproval: {
      create: vi.fn(),
      update: vi.fn(),
    },
    executionRequest: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock artifact storage service
vi.mock('../../services/artifact-storage/index.js', () => ({
  getArtifact: vi.fn(),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getArtifact } from '../../services/artifact-storage/index.js';
import { registerArtifactsRoute } from './artifacts.js';

describe('Artifact Retrieval API — PR #35', () => {
  let app;
  const testWorkspaceId = 'test-workspace-123';
  const testExecutionId = 'test-execution-456';
  const testArtifactId = 'test-artifact-789';
  const otherWorkspaceId = 'other-workspace-999';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Express app with mock middleware
    app = express();
    app.use(express.json());

    // Mock auth middleware
    app.use((req, res, next) => {
      req.workspaceId = testWorkspaceId;
      req.user = { uid: 'test-user-123' };
      next();
    });

    const router = express.Router();
    registerArtifactsRoute(router);
    app.use('/api/execute', router);
    app.use('/api', router);
  });
  describe('GET /api/execute/:executionId/artifacts/pending-approval', () => {
    it('should list only pending approval artifacts', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      const mockArtifacts = [
        {
          id: testArtifactId,
          nodeId: 'node-1',
          type: 'hook',
          createdAt: new Date(),
          approval: {
            id: 'approval-1',
            status: 'PENDING',
            decision: null,
            reviewerId: null,
            feedback: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      prisma.artifact.findMany.mockResolvedValue(mockArtifacts);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts/pending-approval`)
        .expect(200);

      expect(response.body.artifacts).toHaveLength(1);
      expect(response.body.artifacts[0].id).toBe(testArtifactId);
      expect(response.body.artifacts[0].approval.status).toBe('PENDING');
      expect(response.body.count).toBe(1);

      // Verify filter was passed to prisma
      expect(prisma.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            approval: {
              status: 'PENDING',
            },
          }),
        })
      );
    });

    it('should return empty array when no pending approvals', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      prisma.artifact.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts/pending-approval`)
        .expect(200);

      expect(response.body.artifacts).toHaveLength(0);
      expect(response.body.count).toBe(0);
    });

    it('should order by createdAt ascending (oldest first)', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      prisma.artifact.findMany.mockResolvedValue([]);

      await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts/pending-approval`)
        .expect(200);

      // Verify ordering was passed to prisma
      expect(prisma.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
        })
      );
    });

    it('should return 404 for non-existent execution', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/execute/non-existent-id/artifacts/pending-approval')
        .expect(404);

      expect(response.body.error).toContain('Execution not found');
    });

    it('should return 403 for execution in different workspace', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: 'other-execution',
        workspaceId: otherWorkspaceId,
      });

      const response = await request(app)
        .get('/api/execute/other-execution/artifacts/pending-approval')
        .expect(403);

      expect(response.body.error).toContain('Unauthorized');
    });
  });

});
