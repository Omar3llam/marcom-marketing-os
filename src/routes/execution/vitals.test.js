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
      findMany:   vi.fn(),
      count:      vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
    },
    executionTransition: { findMany: vi.fn() },
    auditLog: {
      create:   vi.fn(),
      findMany: vi.fn(),
      count:    vi.fn(),
    },
  },
}));

vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    getExecutionState: vi.fn(),
    transition:        vi.fn(),
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../events.js', () => ({
  broadcastWorkspaceEvent: vi.fn(),
}));

vi.mock('../../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(),
}));

// vi.mock factories are hoisted before variable declarations.
// Use vi.fn() directly inside the factory; import the mocked
// module below to get handles for per-test configuration.
vi.mock('../../queues/index.js', () => ({
  executionQueue: {
    getFailedCount: vi.fn(),
    count:          vi.fn(),
  },
  enqueueExecution:     vi.fn(),
  actionQueue:          null,
  observerQueue:        null,
  syncQueue:            null,
  EXECUTION_QUEUE_NAME: 'executions',
  ACTION_QUEUE_NAME:    'actions',
}));

vi.mock('../../services/execution/workerHealth.js', () => ({
  startHeartbeat:      vi.fn(() => ({ workerId: 'test', stop: vi.fn() })),
  getWorkerHeartbeats: vi.fn(),
}));

import { prisma }               from '../../lib/prisma.js';
import { executionQueue }       from '../../queues/index.js';
import { getWorkerHeartbeats }  from '../../services/execution/workerHealth.js';
import { firebaseAuthMiddleware } from '../../middleware/firebaseAuth.js';

describe('GET /api/execute/vitals', () => {
  let app;
  const workspaceId = 'test-workspace-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default queue stats — zero for clean baseline.
    executionQueue.getFailedCount.mockResolvedValue(0);
    executionQueue.count.mockResolvedValue(0);
    getWorkerHeartbeats.mockResolvedValue([]);

    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  it('returns counts and p95 latency for the workspace', async () => {
    prisma.executionRequest.count
      .mockResolvedValueOnce(3)    // inFlightCount
      .mockResolvedValueOnce(142)  // successPerHour
      .mockResolvedValueOnce(3)    // failedPerHour
      .mockResolvedValueOnce(0);   // stalePendingCount

    // Five terminal executions — known durations (ms): 100 200 300 400 500.
    // p95 rank = 0.95 × 4 = 3.8 → lower=3 (400), upper=4 (500), weight=0.8
    // p95 = 400 + (500 - 400) × 0.8 = 480
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
      inFlightCount:  3,
      successPerHour: 142,
      failedPerHour:  3,
      p95LatencyMs:   480,
      windowMinutes:  60,
    });
    expect(response.body.serverNow).toBeDefined();

    // Confirm each count was workspace-scoped.
    const countCalls = prisma.executionRequest.count.mock.calls.map((c) => c[0]);
    expect(countCalls[0].where).toMatchObject({
      workspaceId,
      status: { in: ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'] },
    });
    expect(countCalls[1].where).toMatchObject({ workspaceId, status: 'EXECUTED_SUCCESS' });
    expect(countCalls[1].where.updatedAt.gte).toBeInstanceOf(Date);
    expect(countCalls[2].where).toMatchObject({
      workspaceId,
      status: { in: ['EXECUTED_FAILED', 'TIMED_OUT'] },
    });
  });

  it('returns p95=null when no terminal executions exist', async () => {
    prisma.executionRequest.count.mockResolvedValue(0);
    prisma.executionRequest.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body).toMatchObject({
      inFlightCount:  0,
      successPerHour: 0,
      failedPerHour:  0,
      p95LatencyMs:   null,
    });
  });

  it('returns the only sample when exactly one terminal execution exists', async () => {
    prisma.executionRequest.count.mockResolvedValue(0);
    const t = new Date();
    prisma.executionRequest.findMany.mockResolvedValueOnce([
      { createdAt: t, updatedAt: new Date(t.getTime() + 750) },
    ]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body.p95LatencyMs).toBe(750);
  });

  it('includes deadLetterCount and queueDepth from BullMQ', async () => {
    prisma.executionRequest.count.mockResolvedValue(0);
    prisma.executionRequest.findMany.mockResolvedValue([]);
    executionQueue.getFailedCount.mockResolvedValue(7);
    executionQueue.count.mockResolvedValue(3);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body.deadLetterCount).toBe(7);
    expect(response.body.queueDepth).toBe(3);
  });

  it('returns null for queue stats when queue throws (Redis degradation)', async () => {
    prisma.executionRequest.count.mockResolvedValue(0);
    prisma.executionRequest.findMany.mockResolvedValue([]);
    executionQueue.getFailedCount.mockRejectedValue(new Error('Redis down'));
    executionQueue.count.mockRejectedValue(new Error('Redis down'));

    const response = await request(app).get('/api/execute/vitals').expect(200);

    // Graceful degradation — queue stats are null, not 500.
    expect(response.body.deadLetterCount).toBeNull();
    expect(response.body.queueDepth).toBeNull();
  });

  it('includes stalePendingCount for orphaned PENDING executions', async () => {
    prisma.executionRequest.count
      .mockResolvedValueOnce(1)  // inFlightCount
      .mockResolvedValueOnce(0)  // successPerHour
      .mockResolvedValueOnce(0)  // failedPerHour
      .mockResolvedValueOnce(2); // stalePendingCount
    prisma.executionRequest.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body.stalePendingCount).toBe(2);

    // Confirm stale PENDING query is workspace-scoped with correct status + date filter.
    const stalePendingCall = prisma.executionRequest.count.mock.calls[3][0];
    expect(stalePendingCall.where.status).toBe('PENDING');
    expect(stalePendingCall.where.workspaceId).toBe(workspaceId);
    expect(stalePendingCall.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('includes activeWorkerCount from heartbeats', async () => {
    prisma.executionRequest.count.mockResolvedValue(0);
    prisma.executionRequest.findMany.mockResolvedValue([]);
    getWorkerHeartbeats.mockResolvedValue([
      { workerId: '1234', lastBeatAt: new Date().toISOString(), aliveMs: 5000 },
      { workerId: '5678', lastBeatAt: new Date().toISOString(), aliveMs: 3000 },
    ]);

    const response = await request(app).get('/api/execute/vitals').expect(200);

    expect(response.body.activeWorkerCount).toBe(2);
  });

  it('returns 500 on prisma failure', async () => {
    prisma.executionRequest.count.mockRejectedValueOnce(new Error('boom'));

    const response = await request(app).get('/api/execute/vitals').expect(500);

    expect(response.body.code).toBe('VITALS_ERROR');
  });
});
