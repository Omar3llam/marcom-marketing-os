// ============================================================
// executionMetrics tests — PR #14
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordExecutionMetric } from './executionMetrics.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: { findUnique: vi.fn() },
    executionTransition: { findMany: vi.fn() },
    executionMetric: { create: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const WORKSPACE_ID = 'ws-uuid-0001';
const EXEC_ID      = 'exec-cuid-0001';

const makeExecution = (overrides = {}) => ({
  createdAt: new Date('2025-01-01T10:00:00Z'),
  response:  null,
  ...overrides,
});

const makeTransitions = ({ withExecuting = true, retries = 0 } = {}) => {
  const rows = [];
  rows.push({ fromStatus: 'PENDING', toStatus: 'QUEUED',    createdAt: new Date('2025-01-01T10:00:05Z'), actor: 'WORKER' });
  if (withExecuting) {
    rows.push({ fromStatus: 'QUEUED',   toStatus: 'EXECUTING', createdAt: new Date('2025-01-01T10:00:10Z'), actor: 'WORKER' });
  }
  for (let i = 0; i < retries; i++) {
    rows.push({ fromStatus: 'EXECUTING', toStatus: 'EXECUTING', createdAt: new Date('2025-01-01T10:00:15Z'), actor: 'RETRY_POLICY' });
  }
  rows.push({ fromStatus: 'EXECUTING', toStatus: 'EXECUTED_SUCCESS', createdAt: new Date('2025-01-01T10:00:30Z'), actor: 'WORKER' });
  return rows;
};

describe('recordExecutionMetric()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes a metric row with correct timing from transition log', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(makeExecution());
    prisma.executionTransition.findMany.mockResolvedValueOnce(makeTransitions());
    prisma.executionMetric.create.mockResolvedValueOnce({});

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_SUCCESS');

    expect(prisma.executionMetric.create).toHaveBeenCalledOnce();
    const { data } = prisma.executionMetric.create.mock.calls[0][0];

    // queueWaitMs: createdAt(10:00:00) → EXECUTING(10:00:10) = 10_000 ms
    expect(data.queueWaitMs).toBe(10_000);
    // executionMs: EXECUTING(10:00:10) → terminal(10:00:30) = 20_000 ms
    expect(data.executionMs).toBe(20_000);
    expect(data.retryCount).toBe(0);
    expect(data.timeoutOccurred).toBe(false);
    expect(data.finalStatus).toBe('EXECUTED_SUCCESS');
    expect(data.workspaceId).toBe(WORKSPACE_ID);
  });

  it('counts RETRY_POLICY transitions as retryCount', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(makeExecution());
    prisma.executionTransition.findMany.mockResolvedValueOnce(makeTransitions({ retries: 2 }));
    prisma.executionMetric.create.mockResolvedValueOnce({});

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_SUCCESS');

    const { data } = prisma.executionMetric.create.mock.calls[0][0];
    expect(data.retryCount).toBe(2);
  });

  it('sets timeoutOccurred=true for TIMED_OUT final status', async () => {
    const transitions = [
      { fromStatus: 'PENDING',   toStatus: 'EXECUTING', createdAt: new Date('2025-01-01T10:00:05Z'), actor: 'WORKER' },
      { fromStatus: 'EXECUTING', toStatus: 'TIMED_OUT', createdAt: new Date('2025-01-01T10:05:00Z'), actor: 'TIMEOUT_HANDLER' },
    ];
    prisma.executionRequest.findUnique.mockResolvedValueOnce(makeExecution());
    prisma.executionTransition.findMany.mockResolvedValueOnce(transitions);
    prisma.executionMetric.create.mockResolvedValueOnce({});

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'TIMED_OUT');

    const { data } = prisma.executionMetric.create.mock.calls[0][0];
    expect(data.timeoutOccurred).toBe(true);
  });

  it('sets queueWaitMs=null and executionMs=null when no EXECUTING transition', async () => {
    const transitions = [
      { fromStatus: 'PENDING', toStatus: 'EXECUTED_FAILED', createdAt: new Date('2025-01-01T10:00:10Z'), actor: 'WORKER' },
    ];
    prisma.executionRequest.findUnique.mockResolvedValueOnce(makeExecution());
    prisma.executionTransition.findMany.mockResolvedValueOnce(transitions);
    prisma.executionMetric.create.mockResolvedValueOnce({});

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_FAILED');

    const { data } = prisma.executionMetric.create.mock.calls[0][0];
    expect(data.queueWaitMs).toBeNull();
    expect(data.executionMs).toBeNull();
  });

  it('extracts agentUsed + tokenEstimate from response payload', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(
      makeExecution({ response: { agent: 'claude', tokenEstimate: 1200 } }),
    );
    prisma.executionTransition.findMany.mockResolvedValueOnce(makeTransitions());
    prisma.executionMetric.create.mockResolvedValueOnce({});

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_SUCCESS');

    const { data } = prisma.executionMetric.create.mock.calls[0][0];
    expect(data.agentUsed).toBe('claude');
    expect(data.tokenEstimate).toBe(1200);
  });

  it('swallows errors and logs — never throws', async () => {
    prisma.executionRequest.findUnique.mockRejectedValueOnce(new Error('DB offline'));

    await expect(recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_SUCCESS'))
      .resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
    expect(prisma.executionMetric.create).not.toHaveBeenCalled();
  });

  it('is a no-op when execution row is missing (deleted between steps)', async () => {
    prisma.executionRequest.findUnique.mockResolvedValueOnce(null);
    prisma.executionTransition.findMany.mockResolvedValueOnce([]);

    await recordExecutionMetric(EXEC_ID, WORKSPACE_ID, 'EXECUTED_SUCCESS');

    expect(prisma.executionMetric.create).not.toHaveBeenCalled();
  });
});
