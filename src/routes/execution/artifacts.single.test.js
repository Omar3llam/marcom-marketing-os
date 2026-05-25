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
  describe('GET /api/artifacts/:id', () => {
    it('should retrieve single artifact with full content', async () => {
      const mockArtifact = {
        id: testArtifactId,
        workspaceId: testWorkspaceId,
        executionId: testExecutionId,
        nodeId: 'node-1',
        nodeType: 'ai-generation',
        type: 'hook',
        capability: 'GENERATE_HOOKS',
        provider: 'CLAUDE',
        version: 1,
        size: 512,
        storageKey: 'test/key.json',
        metadata: { tokens: 100 },
        createdAt: new Date(),
        approval: null,
      };

      prisma.artifact.findUnique.mockResolvedValue(mockArtifact);

      getArtifact.mockResolvedValue({
        ...mockArtifact,
        content: JSON.stringify({
          hook: 'Test hook content',
          angle: 'problem',
          rationale: 'Test rationale',
        }),
      });

      const response = await request(app)
        .get(`/api/artifacts/${testArtifactId}`)
        .expect(200);

      expect(response.body.artifact).toMatchObject({
        id: testArtifactId,
        executionId: testExecutionId,
        nodeId: 'node-1',
        type: 'hook',
        capability: 'GENERATE_HOOKS',
        provider: 'CLAUDE',
        version: 1,
      });

      // Content should be included
      expect(response.body.artifact.content).toBeTruthy();
      const content = JSON.parse(response.body.artifact.content);
      expect(content).toHaveProperty('hook');
      expect(content).toHaveProperty('angle');
      expect(content).toHaveProperty('rationale');
    });

    it('should include approval status', async () => {
      prisma.artifact.findUnique.mockResolvedValue({
        id: testArtifactId,
        workspaceId: testWorkspaceId,
        approval: {
          id: 'approval-1',
          status: 'PENDING',
          decision: null,
          reviewerId: null,
          feedback: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      getArtifact.mockResolvedValue({
        id: testArtifactId,
        content: '{}',
        createdAt: new Date(),
      });

      const response = await request(app)
        .get(`/api/artifacts/${testArtifactId}`)
        .expect(200);

      expect(response.body.approval).toBeTruthy();
      expect(response.body.approval.status).toBe('PENDING');
      expect(response.body.approval.id).toBeTruthy();
    });

    it('should return null approval for artifacts without approval', async () => {
      prisma.artifact.findUnique.mockResolvedValue({
        id: testArtifactId,
        workspaceId: testWorkspaceId,
        approval: null,
      });

      getArtifact.mockResolvedValue({
        id: testArtifactId,
        content: '{}',
        createdAt: new Date(),
      });

      const response = await request(app)
        .get(`/api/artifacts/${testArtifactId}`)
        .expect(200);

      expect(response.body.approval).toBeNull();
    });

    it('should return 404 for non-existent artifact', async () => {
      prisma.artifact.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/artifacts/non-existent-artifact-id')
        .expect(404);

      expect(response.body.error).toContain('Artifact not found');
    });

    it('should return 403 for artifact in different workspace', async () => {
      prisma.artifact.findUnique.mockResolvedValue({
        id: 'other-artifact',
        workspaceId: otherWorkspaceId,
        approval: null,
      });

      const response = await request(app)
        .get('/api/artifacts/other-artifact')
        .expect(403);

      expect(response.body.error).toContain('Unauthorized');
    });

    it('should return 500 when content retrieval fails', async () => {
      prisma.artifact.findUnique.mockResolvedValue({
        id: testArtifactId,
        workspaceId: testWorkspaceId,
        approval: null,
      });

      getArtifact.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/artifacts/${testArtifactId}`)
        .expect(500);

      expect(response.body.error).toContain('Failed to retrieve artifact content');
    });
  });

  describe('Response Format', () => {
    it('should exclude content from list responses', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      prisma.artifact.findMany.mockResolvedValue([
        {
          id: 'artifact-1',
          content: 'large content',
          createdAt: new Date(),
          approval: null,
        },
      ]);
      prisma.artifact.count.mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts`)
        .expect(200);

      response.body.artifacts.forEach(artifact => {
        expect(artifact).not.toHaveProperty('content');
      });
    });

    it('should include content in single artifact retrieval', async () => {
      prisma.artifact.findUnique.mockResolvedValue({
        id: testArtifactId,
        workspaceId: testWorkspaceId,
        approval: null,
      });

      getArtifact.mockResolvedValue({
        id: testArtifactId,
        content: 'test content',
        createdAt: new Date(),
      });

      const response = await request(app)
        .get(`/api/artifacts/${testArtifactId}`)
        .expect(200);

      expect(response.body.artifact.content).toBeTruthy();
    });

    it('should format approval object correctly', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: testExecutionId,
        workspaceId: testWorkspaceId,
      });

      prisma.artifact.findMany.mockResolvedValue([
        {
          id: 'artifact-1',
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
      ]);
      prisma.artifact.count.mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/execute/${testExecutionId}/artifacts`)
        .expect(200);

      const artifactWithApproval = response.body.artifacts.find(
        a => a.approval !== null
      );

      expect(artifactWithApproval.approval).toMatchObject({
        id: expect.any(String),
        status: expect.any(String),
        decision: null,
        reviewerId: null,
        feedback: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });
});
