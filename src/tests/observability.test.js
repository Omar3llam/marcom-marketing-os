// ============================================================
// Observability Routes — Integration Tests
// ============================================================
// Validates the happy-path response shape for all three
// Mission Control endpoints. Prisma is mocked so these tests
// run without a real database connection.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { observabilityRouter } from '../routes/observability/index.js';

// ── Mock Prisma ──────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    executionMetric: {
      findMany: vi.fn(),
    },
    executionTransition: {
      findMany: vi.fn(),
    },
    approvalDecision: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';

// ── Test app setup ───────────────────────────────────────────
function buildApp(workspaceId = 'ws-test-uuid') {
  const app = express();
  app.use((req, _res, next) => {
    req.workspaceId = workspaceId;
    next();
  });
  app.use(observabilityRouter);
  return app;
}

// ── Fixture data ─────────────────────────────────────────────
const NOW = new Date('2026-05-31T12:00:00Z');

const QUEUED_EXECUTIONS = [
  { id: 'exec-q1', createdAt: new Date(NOW.getTime() - 30_000) },
  { id: 'exec-q2', createdAt: new Date(NOW.getTime() - 60_000) },
];
const RECENT_ACTIVITY = [
  {
    id: 'exec-a1',
    status: 'EXECUTING',
    activeStep: 'generate_hooks',
    createdAt: new Date(NOW.getTime() - 5_000),
    updatedAt: new Date(NOW.getTime() - 1_000),
    correlationId: 'corr-abc',
  },
];

function mockLivePrisma() {
  prisma.executionRequest.groupBy.mockResolvedValue([
    { status: 'EXECUTING',            _count: { id: 2 } },
    { status: 'PAUSED_FOR_APPROVAL',  _count: { id: 1 } },
    { status: 'PENDING',              _count: { id: 3 } },
    { status: 'FAILED',               _count: { id: 1 } },
  ]);
  // live.js calls findMany twice inside Promise.all — use implementation to
  // return different data per call without queued Once values bleeding between tests.
  let findManyCall = 0;
  prisma.executionRequest.findMany.mockImplementation(() => {
    return Promise.resolve(findManyCall++ === 0 ? QUEUED_EXECUTIONS : RECENT_ACTIVITY);
  });
  prisma.executionRequest.count.mockResolvedValue(1);
}

function mockProvidersPrisma() {
  prisma.executionMetric.findMany.mockResolvedValue([
    { agentUsed: 'claude',  finalStatus: 'EXECUTED_SUCCESS', executionMs: 2500, tokenEstimate: 1200, executionId: 'exec-1' },
    { agentUsed: 'claude',  finalStatus: 'EXECUTED_SUCCESS', executionMs: 3000, tokenEstimate: 900,  executionId: 'exec-2' },
    { agentUsed: 'openai',  finalStatus: 'EXECUTED_FAILED',  executionMs: null, tokenEstimate: null, executionId: 'exec-3' },
  ]);
  prisma.approvalDecision.findMany.mockResolvedValue([
    { provider: 'claude', decision: 'APPROVED' },
    { provider: 'claude', decision: 'REJECTED' },
  ]);
}

function mockFailuresPrisma() {
  prisma.executionRequest.findMany.mockResolvedValue([
    {
      id: 'exec-f1',
      status: 'FAILED',
      activeStep: 'execute_meta_action',
      correlationId: 'corr-xyz',
      updatedAt: new Date(NOW.getTime() - 3600_000),
      payload: { actionType: 'PAUSE_CAMPAIGN' },
    },
  ]);
  prisma.executionMetric.findMany.mockResolvedValue([
    { executionId: 'exec-f1', agentUsed: 'claude', retryCount: 2 },
  ]);
  prisma.executionTransition.findMany.mockResolvedValue([
    {
      executionId: 'exec-f1',
      reason: 'meta_api_rate_limit',
      toStatus: 'FAILED',
      createdAt: new Date(NOW.getTime() - 3600_000),
    },
  ]);
}

// ────────────────────────────────────────────────────────────
describe('GET /live — happy path', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLivePrisma();
  });

  it('returns 200 with correct shape', async () => {
    const res = await supertest(buildApp()).get('/live');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      executions: {
        active:            expect.any(Number),
        paused:            expect.any(Number),
        queued:            expect.any(Number),
        failed_last_hour:  expect.any(Number),
      },
      queue: {
        depth:            expect.any(Number),
        avg_wait_ms:      expect.any(Number),
        oldest_queued_at: expect.any(String),
      },
      recent_activity: expect.any(Array),
      generated_at:    expect.any(String),
    });
  });

  it('aggregates status counts correctly', async () => {
    const res = await supertest(buildApp()).get('/live');
    expect(res.body.executions.active).toBe(2);  // EXECUTING
    expect(res.body.executions.paused).toBe(1);  // PAUSED_FOR_APPROVAL
    expect(res.body.executions.queued).toBe(3);  // PENDING
    expect(res.body.executions.failed_last_hour).toBe(1);
  });

  it('returns queue depth = number of queued executions', async () => {
    const res = await supertest(buildApp()).get('/live');
    expect(res.body.queue.depth).toBe(2);
    expect(res.body.queue.avg_wait_ms).toBeGreaterThan(0);
    expect(res.body.queue.oldest_queued_at).toBeTruthy();
  });

  it('formats recent_activity items correctly', async () => {
    const res = await supertest(buildApp()).get('/live');
    const [item] = res.body.recent_activity;
    expect(item).toMatchObject({
      execution_id:   'exec-a1',
      status:         'EXECUTING',
      active_step:    'generate_hooks',
      correlation_id: 'corr-abc',
      elapsed_ms:     expect.any(Number),
    });
  });

  it('returns 401 when workspaceId is missing', async () => {
    const app = buildApp(null);
    const res = await supertest(app).get('/live');
    expect(res.status).toBe(401);
  });

  it('returns 500 when Prisma throws', async () => {
    prisma.executionRequest.groupBy.mockRejectedValue(new Error('DB down'));
    const res = await supertest(buildApp()).get('/live');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch live metrics');
  });
});

// ────────────────────────────────────────────────────────────
describe('GET /providers — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvidersPrisma();
  });

  it('returns 200 with correct shape', async () => {
    const res = await supertest(buildApp()).get('/providers');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      window:       'last_24h',
      providers:    expect.any(Array),
      generated_at: expect.any(String),
    });
  });

  it('calculates success rate and avg latency per provider', async () => {
    const res = await supertest(buildApp()).get('/providers');
    const claude = res.body.providers.find((p) => p.provider === 'claude');
    expect(claude).toBeDefined();
    expect(claude.success_rate).toBe(1);       // 2/2 successes
    expect(claude.avg_latency_ms).toBe(2750);  // (2500+3000)/2
    expect(claude.token_estimate).toBe(2100);  // 1200+900
  });

  it('includes approval_rate when approvals exist', async () => {
    const res = await supertest(buildApp()).get('/providers');
    const claude = res.body.providers.find((p) => p.provider === 'claude');
    expect(claude.approval_rate).toBe(0.5); // 1 approved / 2 total
  });

  it('returns 401 when workspaceId is missing', async () => {
    const res = await supertest(buildApp(null)).get('/providers');
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────
describe('GET /failures — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFailuresPrisma();
  });

  it('returns 200 with correct shape', async () => {
    const res = await supertest(buildApp()).get('/failures');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      window:       'last_24h',
      failures:     expect.any(Array),
      count:        expect.any(Number),
      generated_at: expect.any(String),
    });
  });

  it('populates failure items with provider, retry_count, and error_context', async () => {
    const res = await supertest(buildApp()).get('/failures');
    const [failure] = res.body.failures;
    expect(failure).toMatchObject({
      execution_id:   'exec-f1',
      status:         'FAILED',
      active_step:    'execute_meta_action',
      provider:       'claude',
      retry_count:    2,
      error_context:  'meta_api_rate_limit',
      correlation_id: 'corr-xyz',
    });
  });

  it('returns empty failures array when no failures in window', async () => {
    prisma.executionRequest.findMany.mockResolvedValue([]);
    prisma.executionMetric.findMany.mockResolvedValue([]);
    prisma.executionTransition.findMany.mockResolvedValue([]);
    const res = await supertest(buildApp()).get('/failures');
    expect(res.status).toBe(200);
    expect(res.body.failures).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns 401 when workspaceId is missing', async () => {
    const res = await supertest(buildApp(null)).get('/failures');
    expect(res.status).toBe(401);
  });
});
