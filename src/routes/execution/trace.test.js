// ============================================================
// GET /api/execute/:id/trace — route tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import executionRouter from './index.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionRequest:    { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    executionTransition: { findMany: vi.fn() },
    executionMetric:     { findFirst: vi.fn() },
    auditLog:            { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../../services/execution-engine/observability/eventStore.js', () => ({
  eventStore: { getEvents: vi.fn(() => []) },
}));

vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { getExecutionState: vi.fn(), transition: vi.fn() },
}));

vi.mock('../../middleware/firebaseAuth.js', () => ({
  firebaseAuthMiddleware: (req, res, next) => {
    req.user = { uid: 'user-1' };
    req.workspaceId = 'ws-111';
    req.userId = 'user-1';
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

vi.mock('../../queues/index.js', () => ({
  executionQueue:   { getFailedCount: vi.fn(), count: vi.fn() },
  enqueueExecution: vi.fn(),
}));

vi.mock('../../services/execution/workerHealth.js', () => ({
  getWorkerHeartbeats: vi.fn().mockResolvedValue([]),
}));

import { prisma } from '../../lib/prisma.js';

const EXECUTION_ID = 'exec-trace-route-1';
const WORKSPACE_ID = 'ws-111';

const BASE_REQUEST = {
  id: EXECUTION_ID, workspaceId: WORKSPACE_ID,
  status: 'EXECUTED_SUCCESS', actionType: 'PAUSE_CAMPAIGN', targetId: 'camp-7',
  correlationId: 'corr-R', retryMetadata: null,
  createdAt: new Date('2026-05-21T10:00:00.000Z'),
  updatedAt: new Date('2026-05-21T10:00:30.000Z'),
};

const TRANSITIONS = [
  {
    id: 'tr1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
    previousVersion: 0, newVersion: 1, reason: null, metadata: null,
    correlationId: 'corr-R', createdAt: new Date('2026-05-21T10:00:01.000Z'),
  },
  {
    id: 'tr2', fromStatus: 'QUEUED', toStatus: 'EXECUTED_SUCCESS', actor: 'WORKER',
    previousVersion: 1, newVersion: 2, reason: null, metadata: null,
    correlationId: 'corr-R', createdAt: new Date('2026-05-21T10:00:28.000Z'),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.executionRequest.findFirst.mockResolvedValue(BASE_REQUEST);
  prisma.executionTransition.findMany.mockResolvedValue(TRANSITIONS);
  prisma.executionMetric.findFirst.mockResolvedValue({
    queueWaitMs: 3000, executionMs: 27000, retryCount: 0,
    timeoutOccurred: false, agentUsed: 'claude', finalStatus: 'EXECUTED_SUCCESS',
  });
});

describe('GET /api/execute/:id/trace', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/execute', executionRouter);
  });

  it('returns 200 with serialized trace', async () => {
    const res = await request(app)
      .get(`/api/execute/${EXECUTION_ID}/trace`)
      .expect(200);

    expect(res.body.executionId).toBe(EXECUTION_ID);
    expect(res.body.status).toBe('EXECUTED_SUCCESS');
    expect(res.body.correlationId).toBe('corr-R');
    expect(res.body.timeline).toHaveLength(2);
    expect(res.body.summary.queueWaitMs).toBe(3000);
  });

  it('timeline entries have narrative field', async () => {
    const res = await request(app)
      .get(`/api/execute/${EXECUTION_ID}/trace`)
      .expect(200);

    for (const entry of res.body.timeline) {
      expect(typeof entry.narrative).toBe('string');
      expect(entry.narrative.length).toBeGreaterThan(0);
    }
  });

  it('returns 404 when execution is not found', async () => {
    prisma.executionRequest.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/execute/nonexistent/trace`)
      .expect(404);

    expect(res.body.code).toBe('EXECUTION_NOT_FOUND');
  });

  it('returns 500 on unexpected db error', async () => {
    prisma.executionRequest.findFirst.mockRejectedValue(new Error('DB down'));

    const res = await request(app)
      .get(`/api/execute/${EXECUTION_ID}/trace`)
      .expect(500);

    expect(res.body.code).toBe('TRACE_FETCH_ERROR');
  });

  it('timeline is ordered by timestamp ascending', async () => {
    const res = await request(app)
      .get(`/api/execute/${EXECUTION_ID}/trace`)
      .expect(200);

    const timestamps = res.body.timeline.map(e => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });
});
