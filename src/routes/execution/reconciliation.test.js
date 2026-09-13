// ============================================================
// Reconciliation Endpoint Tests — GET /api/execute/:id/active
// Phase 11B Task 5
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import executionRouter from './index.js';
import { ExecutionStatus } from '@marcom/runtime-contracts';

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
    // Slice C: the /api/execute mount now applies an authorization baseline to
    // every route it assembles, so a request needs a ROLE and not only an
    // identity. This suite is about the route's behaviour, so it seats an
    // operator explicitly — which it was relying on implicitly before, when the
    // mount asked nobody. Refusal of a CLIENT is proven in
    // src/tests/executeMountAuthorization.red.test.js, not here.
    req.collabRole = 'STRATEGIST';
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

describe('GET /api/execute/:id/active', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  it('should return reconciliation payload for active execution', async () => {
    const executionId = 'exec-active-123';
    const workspaceId = 'test-workspace-456';

    lifecycleService.getExecutionState.mockResolvedValue({
      executionId,
      correlationId: 'corr-123',
      status: ExecutionStatus.EXECUTING,
      version: 5,
      isTerminal: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastTransitionAt: '2026-05-20T10:00:00.000Z',
      serverNow: '2026-05-20T10:01:00.000Z',
      canResume: true,
      isStale: false,
      activeStep: 'GENERATE_STRATEGY',
      retryMetadata: null,
    });

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId,
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(200);

    expect(response.body).toEqual({
      executionId,
      correlationId: 'corr-123',
      status: ExecutionStatus.EXECUTING,
      version: 5,
      isTerminal: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastTransitionAt: '2026-05-20T10:00:00.000Z',
      serverNow: '2026-05-20T10:01:00.000Z',
      canResume: true,
      isStale: false,
      activeStep: 'GENERATE_STRATEGY',
      retryMetadata: null,
    });

    expect(lifecycleService.getExecutionState).toHaveBeenCalledWith(executionId);
    expect(prisma.executionRequest.findUnique).toHaveBeenCalledWith({
      where: { id: executionId },
      select: { workspaceId: true },
    });
  });

  it('should return terminal execution with response payload', async () => {
    const executionId = 'exec-terminal-456';
    const workspaceId = 'test-workspace-456';

    lifecycleService.getExecutionState.mockResolvedValue({
      executionId,
      correlationId: 'corr-456',
      status: ExecutionStatus.EXECUTED_SUCCESS,
      version: 10,
      isTerminal: true,
      updatedAt: '2026-05-20T09:00:00.000Z',
      lastTransitionAt: '2026-05-20T09:00:00.000Z',
      serverNow: '2026-05-20T10:00:00.000Z',
      canResume: false,
      isStale: false,
      activeStep: null,
      retryMetadata: null,
      response: {
        success: true,
        campaignId: 'camp-123',
      },
    });

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId,
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(200);

    expect(response.body.status).toBe(ExecutionStatus.EXECUTED_SUCCESS);
    expect(response.body.isTerminal).toBe(true);
    expect(response.body.canResume).toBe(false);
    expect(response.body.response).toEqual({
      success: true,
      campaignId: 'camp-123',
    });
  });

  it('should return stale execution when timed out', async () => {
    const executionId = 'exec-stale-789';
    const workspaceId = 'test-workspace-456';

    lifecycleService.getExecutionState.mockResolvedValue({
      executionId,
      correlationId: 'corr-789',
      status: ExecutionStatus.EXECUTING,
      version: 3,
      isTerminal: false,
      updatedAt: '2026-05-20T08:00:00.000Z',
      lastTransitionAt: '2026-05-20T08:00:00.000Z',
      serverNow: '2026-05-20T10:00:00.000Z',
      canResume: false,
      isStale: true,
      activeStep: 'GENERATE_STRATEGY',
      retryMetadata: null,
    });

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId,
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(200);

    expect(response.body.isStale).toBe(true);
    expect(response.body.canResume).toBe(false);
  });

  it('should return 404 if execution not found', async () => {
    const executionId = 'exec-nonexistent';

    lifecycleService.getExecutionState.mockRejectedValue(
      new Error(`ExecutionRequest ${executionId} not found`)
    );

    prisma.executionRequest.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('should return 404 if execution belongs to different workspace', async () => {
    const executionId = 'exec-forbidden-123';
    const actualWorkspaceId = 'other-workspace-999';

    lifecycleService.getExecutionState.mockResolvedValue({
      executionId,
      status: ExecutionStatus.EXECUTING,
      version: 2,
      isTerminal: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastTransitionAt: '2026-05-20T10:00:00.000Z',
      serverNow: '2026-05-20T10:01:00.000Z',
      canResume: true,
      isStale: false,
      correlationId: 'corr-123',
      activeStep: null,
      retryMetadata: null,
    });

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId: actualWorkspaceId,
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('should return 500 on internal error', async () => {
    const executionId = 'exec-error-456';

    lifecycleService.getExecutionState.mockRejectedValue(
      new Error('Database connection failed')
    );

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId: 'test-workspace-456',
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(500);

    expect(response.body.code).toBe('RECONCILIATION_ERROR');
  });

  it('should include version field for stale detection', async () => {
    const executionId = 'exec-version-123';
    const workspaceId = 'test-workspace-456';

    lifecycleService.getExecutionState.mockResolvedValue({
      executionId,
      correlationId: 'corr-123',
      status: ExecutionStatus.QUEUED,
      version: 7,
      isTerminal: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastTransitionAt: '2026-05-20T10:00:00.000Z',
      serverNow: '2026-05-20T10:00:30.000Z',
      canResume: true,
      isStale: false,
      activeStep: null,
      retryMetadata: null,
    });

    prisma.executionRequest.findUnique.mockResolvedValue({
      workspaceId,
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/active`)
      .expect(200);

    // incoming.version < local.version → DROP EVENT
    expect(response.body.version).toBe(7);
    expect(typeof response.body.version).toBe('number');
  });
});
