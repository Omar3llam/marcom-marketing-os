// ============================================================
// Active Executions List Tests — GET /api/execute/active
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

describe('GET /api/execute/active', () => {
  let app;
  const workspaceId = 'test-workspace-456';

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/execute', executionRouter);
  });

  it('should return in-flight executions for the workspace', async () => {
    prisma.executionRequest.findMany.mockResolvedValue([
      {
        id: 'exec-1',
        actionType: 'PAUSE_ADSET',
        targetId: 'adset-100',
        status: 'EXECUTING',
        version: 4,
        correlationId: 'corr-A',
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        updatedAt: new Date('2026-05-20T10:00:08.000Z'),
        transitions: [{ actor: 'WORKER' }],
      },
      {
        id: 'exec-2',
        actionType: 'INCREASE_BUDGET',
        targetId: 'campaign-200',
        status: 'QUEUED',
        version: 1,
        correlationId: 'corr-B',
        createdAt: new Date('2026-05-20T10:00:05.000Z'),
        updatedAt: new Date('2026-05-20T10:00:05.000Z'),
        transitions: [],
      },
    ]);

    const response = await request(app).get('/api/execute/active').expect(200);

    expect(prisma.executionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId,
          status: { in: ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    );

    expect(response.body.executions).toHaveLength(2);
    expect(response.body.executions[0]).toMatchObject({
      id: 'exec-1',
      status: 'EXECUTING',
      actor: 'WORKER',
      version: 4,
    });
    // Empty transitions array falls back to SYSTEM
    expect(response.body.executions[1].actor).toBe('SYSTEM');
    expect(response.body.executions[0]).toHaveProperty('ageSeconds');
    expect(typeof response.body.executions[0].ageSeconds).toBe('number');
    expect(response.body.serverNow).toBeDefined();
  });

  it('should return empty list when nothing is in flight', async () => {
    prisma.executionRequest.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/execute/active').expect(200);

    expect(response.body.executions).toEqual([]);
  });

  it('should return 500 on prisma failure', async () => {
    prisma.executionRequest.findMany.mockRejectedValue(new Error('boom'));

    const response = await request(app).get('/api/execute/active').expect(500);

    expect(response.body.code).toBe('ACTIVE_LIST_ERROR');
  });
});
