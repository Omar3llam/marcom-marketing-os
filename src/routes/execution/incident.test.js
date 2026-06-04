// ============================================================
// Incident Endpoint Tests — GET /api/execute/:id/incident
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
import { firebaseAuthMiddleware } from '../../middleware/firebaseAuth.js';

describe('GET /api/execute/:id/incident', () => {
  let app;
  const executionId = 'exec-inc-1';
  const workspaceId = 'test-workspace-456';

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  it('should derive winner/loser + telemetry for failed execution', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: executionId,
      workspaceId,
      actionType: 'PAUSE_ADSET',
      targetId: 'adset-911',
      status: 'TIMED_OUT',
      version: 14,
      correlationId: 'corr-INC',
      createdAt: new Date('2026-05-20T14:00:00.000Z'),
      updatedAt: new Date('2026-05-20T14:09:08.000Z'),
    });

    prisma.executionTransition.findMany.mockResolvedValue([
      { id: 't1', fromStatus: 'PENDING',   toStatus: 'QUEUED',    actor: 'API',
        previousVersion: 0, newVersion: 1, reason: null, metadata: null,
        correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:00:01.000Z') },
      { id: 't2', fromStatus: 'QUEUED',    toStatus: 'EXECUTING', actor: 'WORKER',
        previousVersion: 1, newVersion: 2, reason: null, metadata: null,
        correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:00:05.000Z') },
      { id: 't3', fromStatus: 'EXECUTING', toStatus: 'TIMED_OUT', actor: 'TIMEOUT_HANDLER',
        previousVersion: 2, newVersion: 14, reason: 'timeout exceeded', metadata: { occConflict: true },
        correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:09:08.000Z') },
    ]);

    const response = await request(app)
      .get(`/api/execute/${executionId}/incident`)
      .expect(200);

    expect(response.body.incident).not.toBeNull();
    expect(response.body.incident.winner).toBe('TIMEOUT_HANDLER');
    expect(response.body.incident.loser).toBe('WORKER');
    expect(response.body.incident.title).toBe('FAILED at v14');
    expect(response.body.incident.cause).toBe('timeout exceeded');
    expect(response.body.incident.graph).toMatchObject({
      from: 'EXECUTING',
      winner: 'TIMEOUT_HANDLER',
      loser: 'WORKER',
      resolution: 'TIMED_OUT',
    });

    const tags = response.body.incident.telemetry.map((t) => t.tag);
    expect(tags).toEqual(expect.arrayContaining([
      'occ_conflict', 'retry_count', 'lock_holder', 'correlation', 'last_known_state',
    ]));
    const occRow = response.body.incident.telemetry.find((t) => t.tag === 'occ_conflict');
    expect(occRow.tone).toBe('kill');
  });

  it('should return incident=null for successful execution', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: executionId,
      workspaceId,
      actionType: 'PAUSE_ADSET',
      targetId: 'adset-1',
      status: 'EXECUTED_SUCCESS',
      version: 3,
      correlationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.executionTransition.findMany.mockResolvedValue([
      { id: 't1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
        previousVersion: 0, newVersion: 1, reason: null, metadata: null,
        correlationId: null, createdAt: new Date() },
    ]);

    const response = await request(app)
      .get(`/api/execute/${executionId}/incident`)
      .expect(200);

    expect(response.body.incident).toBeNull();
    expect(response.body.transitions).toHaveLength(1);
  });

  it('should return 403 on workspace mismatch', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: executionId,
      workspaceId: 'someone-else',
      status: 'EXECUTED_FAILED',
      version: 1,
      actionType: 'X', targetId: 'Y', correlationId: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await request(app)
      .get(`/api/execute/${executionId}/incident`)
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
  });
});
