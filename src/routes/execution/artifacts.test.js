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

  describe('GET /api/execute/:executionId/artifacts', () => {
    it('should list all artifacts for execution', async () => {
      // Mock execution lookup
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
        status: 'PAUSED_FOR_APPROVAL',
      });

      // Mock artifacts
      const mockArtifacts = [
        {
          id: 'artifact-1',
          workspaceId: testWorkspaceId,
          executionId: testExecutionId,
          nodeId: 'node-1',
          nodeType: 'ai-generation',
          type: 'hook',
          capability: 'GENERATE_HOOKS',
          provider: 'CLAUDE',
          version: 1,
          size: 512,
          contentHash: 'abc123',
          storageKey: 'test/key1.json',
          metadata: {},
          createdAt: new Date(),
          approval: {
            id: 'approval-1',
            status: 'PENDING',
            decision: null,
            reviewerId: null,
            feedback: null,
            decisionMetadata: null,
            approvedAt: null,
            rejectedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          id: 'artifact-2',
          workspaceId: testWorkspaceId,
          executionId: testExecutionId,
          nodeId: 'node-2',
          nodeType: 'ai-generation',
          type: 'caption',
          capability: 'GENERATE_CAPTIONS',
          provider: 'OPENAI',
          version: 1,
          size: 256,
          contentHash: 'def456',
          storageKey: 'test/key2.json',
          metadata: {},
          createdAt: new Date(),
          approval: null,
        },
      ];

      prisma.artifact.findMany.mockResolvedValue(mockArtifacts);
      prisma.artifact.count.mockResolvedValue(2);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts`)
        .expect(200);

      expect(response.body.artifacts).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        total: 2,
        limit: 100,
        offset: 0,
        hasMore: false,
      });

      // Verify artifact structure
      const artifact = response.body.artifacts[0];
      expect(artifact).toHaveProperty('id');
      expect(artifact).toHaveProperty('executionId', testExecutionId);
      expect(artifact).toHaveProperty('nodeId');
      expect(artifact).toHaveProperty('type');
      expect(artifact).toHaveProperty('capability');
      expect(artifact).toHaveProperty('provider');
      expect(artifact).toHaveProperty('version');
      expect(artifact).not.toHaveProperty('content'); // Excluded from list
    });

    it('should filter artifacts by type', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      const mockArtifacts = [
        {
          id: 'artifact-1',
          workspaceId: testWorkspaceId,
          executionId: testExecutionId,
          nodeId: 'node-1',
          type: 'hook',
          capability: 'GENERATE_HOOKS',
          provider: 'CLAUDE',
          version: 1,
          createdAt: new Date(),
          approval: null,
        },
      ];

      prisma.artifact.findMany.mockResolvedValue(mockArtifacts);
      prisma.artifact.count.mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts?type=hook`)
        .expect(200);

      expect(response.body.artifacts).toHaveLength(1);
      expect(response.body.artifacts[0].type).toBe('hook');

      // Verify filter was passed to prisma
      expect(prisma.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'hook',
          }),
        })
      );
    });

    it('should filter artifacts by nodeId', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      const mockArtifacts = [
        {
          id: 'artifact-1',
          nodeId: 'node-1',
          type: 'hook',
          createdAt: new Date(),
          approval: null,
        },
      ];

      prisma.artifact.findMany.mockResolvedValue(mockArtifacts);
      prisma.artifact.count.mockResolvedValue(1);

      await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts?nodeId=node-1`)
        .expect(200);

      // Verify filter was passed to prisma
      expect(prisma.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nodeId: 'node-1',
          }),
        })
      );
    });

    it('should support pagination', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      prisma.artifact.findMany.mockResolvedValue([
        {
          id: 'artifact-1',
          createdAt: new Date(),
          approval: null,
        },
      ]);
      prisma.artifact.count.mockResolvedValue(2);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts?limit=1&offset=0`)
        .expect(200);

      expect(response.body.artifacts).toHaveLength(1);
      expect(response.body.pagination).toMatchObject({
        total: 2,
        limit: 1,
        offset: 0,
        hasMore: true,
      });

      // Verify pagination was passed to prisma
      expect(prisma.artifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
          skip: 0,
        })
      );
    });

    it('should include approval status in response', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      const mockArtifacts = [
        {
          id: testArtifactId,
          createdAt: new Date(),
          approval: {
            id: 'approval-1',
            status: 'PENDING',
            decision: null,
            reviewerId: null,
            feedback: null,
            decisionMetadata: null,
            approvedAt: null,
            rejectedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      prisma.artifact.findMany.mockResolvedValue(mockArtifacts);
      prisma.artifact.count.mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts`)
        .expect(200);

      expect(response.body.artifacts[0].approval).toBeTruthy();
      expect(response.body.artifacts[0].approval.status).toBe('PENDING');
    });

    it('should return 404 for non-existent execution', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/execute/non-existent-id/artifacts')
        .expect(404);

      expect(response.body.error).toContain('Execution not found');
    });

    it('should return 403 for execution in different workspace', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: 'other-execution',
        workspaceId: otherWorkspaceId,
      });

      const response = await request(app)
        .get('/api/execute/other-execution/artifacts')
        .expect(403);

      expect(response.body.error).toContain('Unauthorized');
    });
  });
});
