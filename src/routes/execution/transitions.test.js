// ============================================================
// Transitions Endpoint Tests — GET /api/execute/:id/transitions
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import executionRouter from './index.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    executionTransition: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    getExecutionState: vi.fn(),
    transition: vi.fn(),
  },
}));

vi.mock('../../middleware/firebaseAuth.js', () => ({
  firebaseAuthMiddleware: (req, res, next) => {
    req.user = {
      userId: 'test-user-123',
      workspaceId: 'test-workspace-456',
    };
    next();
  },
}));

vi.mock('../../middleware/contextGuard.js', () => ({
  contextGuard: (req, res, next) => next(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events.js', () => ({
  broadcastWorkspaceEvent: vi.fn(),
}));

vi.mock('../../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';

describe('GET /api/execute/:id/transitions', () => {
  let app;
  const executionId = 'exec-trans-1';
  const workspaceId = 'test-workspace-456';

  const baseExecution = {
    id: executionId,
    workspaceId,
    actionType: 'PAUSE_ADSET',
    targetId: 'adset-100',
    status: 'EXECUTED_SUCCESS',
    version: 3,
    correlationId: 'corr-T',
    createdAt: new Date('2026-05-20T10:00:00.000Z'),
    updatedAt: new Date('2026-05-20T10:00:22.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/execute', executionRouter);
  });

  it('should return execution + ordered transition chain', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(baseExecution);
    prisma.executionTransition.findMany.mockResolvedValue([
      {
        id: 't1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
        previousVersion: 0, newVersion: 1, reason: null, metadata: null,
        correlationId: 'corr-T', createdAt: new Date('2026-05-20T10:00:01.000Z'),
      },
      {
        id: 't2', fromStatus: 'QUEUED', toStatus: 'EXECUTING', actor: 'WORKER',
        previousVersion: 1, newVersion: 2, reason: null, metadata: null,
        correlationId: 'corr-T', createdAt: new Date('2026-05-20T10:00:05.000Z'),
      },
    ]);

    const response = await request(app)
      .get(`/api/execute/${executionId}/transitions`)
      .expect(200);

    expect(prisma.executionTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { executionId, workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(response.body.execution.id).toBe(executionId);
    expect(response.body.transitions).toHaveLength(2);
    expect(response.body.transitions[0].toStatus).toBe('QUEUED');
  });

  it('should return 404 when execution is missing', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/execute/${executionId}/transitions`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.executionTransition.findMany).not.toHaveBeenCalled();
  });

  it('should return 403 on workspace mismatch', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...baseExecution,
      workspaceId: 'other-workspace',
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/transitions`)
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(prisma.executionTransition.findMany).not.toHaveBeenCalled();
  });
});
