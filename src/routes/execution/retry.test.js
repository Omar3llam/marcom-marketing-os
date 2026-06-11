// ============================================================
// Retry Endpoint Tests — POST /api/execute/:id/retry
// Phase 11C Task 3
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
    req.user = { uid: 'test-user-123' };
    req.workspaceId = 'test-workspace-456';
    req.userId = 'test-user-123';
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

vi.mock('../../queues/index.js', () => ({
  executionQueue:   { getFailedCount: vi.fn(), count: vi.fn() },
  enqueueExecution: vi.fn(),
}));

vi.mock('../../services/execution/workerHealth.js', () => ({
  getWorkerHeartbeats: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(),
}));

import { prisma } from '../../lib/prisma.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';
import { firebaseAuthMiddleware } from '../../middleware/firebaseAuth.js';

describe('POST /api/execute/:id/retry', () => {
  let app;
  const originalId = 'exec-failed-1';
  const workspaceId = 'test-workspace-456';

  const failedOriginal = {
    id: originalId,
    workspaceId,
    actionType: 'PAUSE_ADSET',
    targetId: 'adset-911',
    payload: { actionType: 'PAUSE_ADSET', targetId: 'adset-911', options: {} },
    status: 'EXECUTED_FAILED',
    correlationId: 'corr-retry-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  it('should clone failed execution and transition new request to QUEUED', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(failedOriginal);
    prisma.executionRequest.create.mockResolvedValueOnce({
      id: 'exec-retry-1',
      workspaceId,
      version: 0,
      correlationId: 'corr-retry-1',
    });
    lifecycleService.transition.mockResolvedValueOnce({
      id: 'exec-retry-1',
      status: 'QUEUED',
      version: 1,
    });

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(201);

    expect(response.body).toMatchObject({
      executionId: 'exec-retry-1',
      status: 'QUEUED',
      retryOf: originalId,
      correlationId: 'corr-retry-1',
      version: 1,
    });

    // Clone carries the original's actionType/targetId/payload + fresh idempotencyKey
    const createArgs = prisma.executionRequest.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      workspaceId,
      actionType: 'PAUSE_ADSET',
      targetId: 'adset-911',
      status: 'PENDING',
      correlationId: 'corr-retry-1',
      retryMetadata: expect.objectContaining({
        retryOf: originalId,
        retriedBy: 'test-user-123',
      }),
    });
    expect(createArgs.data.idempotencyKey).toEqual(expect.any(String));
    expect(createArgs.data.idempotencyKey).not.toBe(originalId);

    // Lifecycle transition: PENDING → QUEUED, RETRY_POLICY actor, lineage preserved
    expect(lifecycleService.transition).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-retry-1',
      newStatus: 'QUEUED',
      expectedVersion: 0,
      actor: 'RETRY_POLICY',
      correlationId: 'corr-retry-1',
      metadata: expect.objectContaining({
        reason: 'manual_retry',
        auditMetadata: expect.objectContaining({ retryOf: originalId }),
      }),
    }));
  });

  it('should also accept TIMED_OUT executions for retry', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce({
      ...failedOriginal,
      status: 'TIMED_OUT',
    });
    prisma.executionRequest.create.mockResolvedValueOnce({
      id: 'exec-retry-2',
      workspaceId,
      version: 0,
      correlationId: 'corr-retry-1',
    });
    lifecycleService.transition.mockResolvedValueOnce({
      id: 'exec-retry-2',
      status: 'QUEUED',
      version: 1,
    });

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(201);

    expect(response.body.executionId).toBe('exec-retry-2');
  });

  it('should return 404 when original execution does not exist', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(null);

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
    expect(lifecycleService.transition).not.toHaveBeenCalled();
  });

  it('should return 404 when original belongs to a different workspace', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce({
      ...failedOriginal,
      workspaceId: 'someone-else',
    });

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
    expect(lifecycleService.transition).not.toHaveBeenCalled();
  });

  it('should return 409 when execution is not in a retryable state', async () => {
    const nonRetryable = ['PENDING', 'QUEUED', 'EXECUTING', 'EXECUTED_SUCCESS', 'CANCELLED'];

    for (const status of nonRetryable) {
      vi.clearAllMocks();
      prisma.executionRequest.findUnique.mockResolvedValueOnce({
        ...failedOriginal,
        status,
      });

      const response = await request(app)
        .post(`/api/execute/${originalId}/retry`)
        .expect(409);

      expect(response.body.code).toBe('NOT_RETRYABLE');
      expect(response.body.retryableStatuses).toEqual(['EXECUTED_FAILED', 'TIMED_OUT']);
      expect(prisma.executionRequest.create).not.toHaveBeenCalled();
      expect(lifecycleService.transition).not.toHaveBeenCalled();
    }
  });

  it('should surface 500 if lifecycle transition fails after clone', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(failedOriginal);
    prisma.executionRequest.create.mockResolvedValueOnce({
      id: 'exec-retry-orphan',
      workspaceId,
      version: 0,
      correlationId: 'corr-retry-1',
    });
    lifecycleService.transition.mockRejectedValueOnce(new Error('OCC conflict'));

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(500);

    expect(response.body.code).toBe('RETRY_TRANSITION_FAILED');
    // Operator sees the orphan id so they can clean up if needed.
    expect(response.body.executionId).toBe('exec-retry-orphan');
  });

  it('should return 500 when the initial findUnique throws', async () => {
    prisma.executionRequest.findUnique.mockRejectedValueOnce(new Error('boom'));

    const response = await request(app)
      .post(`/api/execute/${originalId}/retry`)
      .expect(500);

    expect(response.body.code).toBe('RETRY_ERROR');
  });
});
