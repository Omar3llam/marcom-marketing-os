// ============================================================
// GET /api/execute/metrics/summary — route tests (PR #14)
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { executionMetric: { findMany: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { registerMetricsSummaryRoute } from './metrics.js';
import express from 'express';
import request from 'supertest';

function makeApp(workspaceId = 'ws-uuid-0001') {
  const app = express();
  const router = express.Router();
  router.use((req, _res, next) => {
    req.user = { workspaceId, userId: 'user-1' };
    next();
  });
  registerMetricsSummaryRoute(router);
  app.use(router);
  return app;
}

const WS = 'ws-uuid-0001';

const makeRow = (overrides = {}) => ({
  queueWaitMs:    500,
  executionMs:    3000,
  retryCount:     0,
  timeoutOccurred: false,
  agentUsed:      'claude',
  finalStatus:    'EXECUTED_SUCCESS',
  ...overrides,
});

describe('GET /metrics/summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zero-state when no rows exist', async () => {
    prisma.executionMetric.findMany.mockResolvedValueOnce([]);

    const res = await request(makeApp()).get('/metrics/summary');

    expect(res.status).toBe(200);
    expect(res.body.total_executions).toBe(0);
    expect(res.body.success_rate).toBeNull();
    expect(res.body.windowDays).toBe(7);
  });

  it('computes success_rate, retry_rate, timeout_rate correctly', async () => {
    prisma.executionMetric.findMany.mockResolvedValueOnce([
      makeRow({ finalStatus: 'EXECUTED_SUCCESS' }),
      makeRow({ finalStatus: 'EXECUTED_SUCCESS' }),
      makeRow({ finalStatus: 'EXECUTED_FAILED',  retryCount: 1 }),
      makeRow({ finalStatus: 'TIMED_OUT', timeoutOccurred: true }),
    ]);

    const res = await request(makeApp()).get('/metrics/summary');

    expect(res.status).toBe(200);
    expect(res.body.total_executions).toBe(4);
    expect(res.body.success_rate).toBeCloseTo(0.5, 2);   // 2/4
    expect(res.body.retry_rate).toBeCloseTo(0.25, 2);    // 1/4
    expect(res.body.timeout_rate).toBeCloseTo(0.25, 2);  // 1/4
  });

  it('computes avg_queue_wait_ms and avg_execution_ms', async () => {
    prisma.executionMetric.findMany.mockResolvedValueOnce([
      makeRow({ queueWaitMs: 1000, executionMs: 4000 }),
      makeRow({ queueWaitMs: 500,  executionMs: 2000 }),
    ]);

    const res = await request(makeApp()).get('/metrics/summary');

    expect(res.body.avg_queue_wait_ms).toBe(750);
    expect(res.body.avg_execution_ms).toBe(3000);
  });

  it('skips null timing values in averages', async () => {
    prisma.executionMetric.findMany.mockResolvedValueOnce([
      makeRow({ queueWaitMs: null, executionMs: null }),
      makeRow({ queueWaitMs: 600,  executionMs: 2000 }),
    ]);

    const res = await request(makeApp()).get('/metrics/summary');

    expect(res.body.avg_queue_wait_ms).toBe(600);
    expect(res.body.avg_execution_ms).toBe(2000);
  });

  it('returns the most-used agent as top_agent', async () => {
    prisma.executionMetric.findMany.mockResolvedValueOnce([
      makeRow({ agentUsed: 'claude' }),
      makeRow({ agentUsed: 'claude' }),
      makeRow({ agentUsed: 'openai' }),
    ]);

    const res = await request(makeApp()).get('/metrics/summary');
    expect(res.body.top_agent).toBe('claude');
  });

  it('returns 500 on DB error', async () => {
    prisma.executionMetric.findMany.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(makeApp()).get('/metrics/summary');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('METRICS_SUMMARY_ERROR');
  });
});
