// ============================================================
// Vitals Endpoint Tests — GET /api/execute/vitals
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

describe('GET /api/execute/vitals', () => {
  let app;
  const workspaceId = 'test-workspace-456';

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/execute', executionRouter);
  });

  it('should return counts and p95 latency for the workspace', async () => {
    prisma.executionRequest.count
      .mockResolvedValueOnce(3)    // inFlightCount
      .mockResolvedValueOnce(142)  // successPerHour
      .mockResolvedValueOnce(3);   // failedPerHour

    // Five terminal executions with known durations (in ms):
    //   100, 200, 300, 400, 500   → sorted
    // p95 rank = 0.95 * (5 - 1) = 3.8
    //   lower=3 (400), upper=4 (500), weight=0.8
    //   p95 = 400 + (500 - 400) * 0.8 = 480
    const t0 = new Date('2026-05-20T13:00:00.000Z');
    prisma.executionRequest.findMany.mockResolvedValueOnce([
      { createdAt: t0, updatedAt: new Date(t0.getTime() + 100) },
      { createdAt: t0, updatedAt: new Date(t0.getTime() + 200) },
      { createdAt: t0, updatedAt: new Date(t0.getTime() + 300) },
      { createdAt: t0, updatedAt: new Date(t0.getTime() + 400) },
      { createdAt: t0, updatedAt: new Date(t0.getTime() + 500) },
    ]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body).toMatchObject({
      inFlightCount: 3,
      successPerHour: 142,
      failedPerHour: 3,
      p95LatencyMs: 480,
      windowMinutes: 60,
    });
    expect(response.body.serverNow).toBeDefined();

    // Confirm each count was workspace-scoped
    const countCalls = prisma.executionRequest.count.mock.calls.map((c) => c[0]);
    expect(countCalls[0].where).toMatchObject({
      workspaceId,
      status: { in: ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'] },
    });
    expect(countCalls[1].where).toMatchObject({
      workspaceId,
      status: 'EXECUTED_SUCCESS',
    });
    expect(countCalls[1].where.updatedAt.gte).toBeInstanceOf(Date);
    expect(countCalls[2].where).toMatchObject({
      workspaceId,
      status: { in: ['EXECUTED_FAILED', 'TIMED_OUT'] },
    });
  });

  it('should return p95=null when no terminal executions exist', async () => {
    prisma.executionRequest.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.executionRequest.findMany.mockResolvedValueOnce([]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body).toMatchObject({
      inFlightCount: 0,
      successPerHour: 0,
      failedPerHour: 0,
      p95LatencyMs: null,
    });
  });

  it('should return the only sample when exactly one terminal execution exists', async () => {
    prisma.executionRequest.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const t = new Date();
    prisma.executionRequest.findMany.mockResolvedValueOnce([
      { createdAt: t, updatedAt: new Date(t.getTime() + 750) },
    ]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body.p95LatencyMs).toBe(750);
  });

  it('should return 500 on prisma failure', async () => {
    prisma.executionRequest.count.mockRejectedValueOnce(new Error('boom'));

    const response = await request(app).get('/api/execute/vitals').expect(500);

    expect(response.body.code).toBe('VITALS_ERROR');
  });
});
