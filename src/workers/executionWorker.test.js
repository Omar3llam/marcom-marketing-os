// ============================================================
// executionWorker — unit tests
// ============================================================
// Tests the worker's state-machine logic in isolation.
// BullMQ Worker is not instantiated — we extract and call
// processExecution directly by importing the named export and
// exercising the handler through a controlled job mock.
//
// Covered scenarios (from failure-scenarios.md):
//   1. QUEUED → EXECUTING → EXECUTED_SUCCESS  (happy path)
//   2. Non-retriable 4xx → EXECUTED_FAILED, no re-throw
//   3. Retriable error, not last attempt → throws
//   4. Retriable error, last attempt → EXECUTED_FAILED, no re-throw
//   5. Execution already terminal → skipped
//   6. Execution not found in DB → skipped
//   7. Already EXECUTING (BullMQ retry) → skip QUEUED→EXECUTING transition
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────
vi.mock('../queues/connection.js', () => ({
  bullConnection: null,
  QUEUE_PREFIX:   'lumi',
  REDIS_DISABLED: true,
}));

vi.mock('../queues/index.js', () => ({
  EXECUTION_QUEUE_NAME: 'executions',
  executionQueue:       null,
}));

vi.mock('../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(),
}));

vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    transition: vi.fn(),
  },
}));

vi.mock('../services/execution/workerHealth.js', () => ({
  startHeartbeat: () => ({ workerId: 'test-pid', stop: vi.fn() }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: { findUnique: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ────────────────────────────────────
import { executeMetaAction }  from '../services/metaExecutionService.js';
import { lifecycleService }   from '../services/execution/ExecutionLifecycleService.js';
import { prisma }             from '../lib/prisma.js';

// ── Test helpers ─────────────────────────────────────────────
const EXECUTION_ID  = 'exec-worker-test-1';
const WORKSPACE_ID  = 'ws-worker-1';
const USER_ID       = 'user-1';

function makeJob({ attemptsMade = 0, maxAttempts = 3 } = {}) {
  return {
    data: {
      executionId: EXECUTION_ID,
      workspaceId: WORKSPACE_ID,
      userId:      USER_ID,
      actionType:  'PAUSE_CAMPAIGN',
      targetId:    'camp-1',
      options:     {},
    },
    attemptsMade,
    opts: { attempts: maxAttempts },
  };
}

const BASE_EXECUTION = {
  id:            EXECUTION_ID,
  status:        'QUEUED',
  version:       2,
  actionType:    'PAUSE_CAMPAIGN',
  targetId:      'camp-1',
  correlationId: 'corr-1',
};

// We import processExecution via dynamic re-import after mocks are set.
// Vitest hoists vi.mock() calls so this works correctly.
let processExecution;
beforeEach(async () => {
  vi.clearAllMocks();
  // Fresh import each test to pick up cleared mocks.
  const mod = await import('../workers/executionWorker.js');
  // processExecution is the inner handler — expose it for testing.
  // We reach it via startExecutionWorker → the Worker constructor
  // receives it as 2nd arg. We test it indirectly by calling it
  // directly after extracting. Since Worker is not instantiated
  // (BullMQ import is not mocked), we export a named helper.
  // NOTE: We test the logic by importing the module and calling
  // the exported function that wraps processExecution.
  // The actual approach: we mock Worker from bullmq so startExecutionWorker
  // captures the processor, then we invoke it ourselves.
  processExecution = mod.__testProcessExecution;
});

// ── BullMQ Worker mock (captures the processor) ──────────────
let capturedProcessor = null;
vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name, processor, _opts) {
      capturedProcessor = processor;
    }
    on() { return this; }
    close() {}
  },
}));

// Re-import after Worker mock is set up.
beforeEach(async () => {
  vi.clearAllMocks();
  capturedProcessor = null;
  // Trigger startExecutionWorker so the Worker constructor fires
  // and captures the processor.
  const { startExecutionWorker } = await import('../workers/executionWorker.js');
  startExecutionWorker();
  processExecution = capturedProcessor;
});

// ── Tests ─────────────────────────────────────────────────────
describe('executionWorker — processExecution', () => {
  it('happy path: QUEUED → EXECUTING → EXECUTED_SUCCESS', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(BASE_EXECUTION);
    // QUEUED → EXECUTING returns version 3
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 3 });
    // EXECUTING → EXECUTED_SUCCESS
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 4 });
    executeMetaAction.mockResolvedValue({ success: true, data: { id: 'camp-1' } });

    const result = await processExecution(makeJob());

    expect(result).toEqual({ ok: true });
    expect(lifecycleService.transition).toHaveBeenCalledTimes(2);

    const [first, second] = lifecycleService.transition.mock.calls;
    expect(first[0].newStatus).toBe('EXECUTING');
    expect(second[0].newStatus).toBe('EXECUTED_SUCCESS');
  });

  it('non-retriable 4xx → writes EXECUTED_FAILED, does not throw', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(BASE_EXECUTION);
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 3 }); // QUEUED→EXECUTING
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 4 }); // EXECUTING→FAILED
    executeMetaAction.mockResolvedValue({
      success: false, error: 'Unauthorized', platformStatus: 401, code: 'UNAUTHORIZED',
    });

    const result = await processExecution(makeJob());

    expect(result).toEqual({ ok: false });
    const failCall = lifecycleService.transition.mock.calls[1][0];
    expect(failCall.newStatus).toBe('EXECUTED_FAILED');
    expect(failCall.metadata.reason).toBe('non_retriable');
  });

  it('retriable 5xx error, not last attempt → throws without writing EXECUTED_FAILED', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(BASE_EXECUTION);
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 3 });
    executeMetaAction.mockResolvedValue({
      success: false, error: 'Server error', platformStatus: 500, code: 'SERVER_ERROR',
    });

    await expect(processExecution(makeJob({ attemptsMade: 0, maxAttempts: 3 }))).rejects.toThrow();
    // Only QUEUED → EXECUTING was written. EXECUTED_FAILED was NOT written.
    expect(lifecycleService.transition).toHaveBeenCalledTimes(1);
    expect(lifecycleService.transition.mock.calls[0][0].newStatus).toBe('EXECUTING');
  });

  it('retriable error on last attempt → writes EXECUTED_FAILED, does not throw', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(BASE_EXECUTION);
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 3 });
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 4 });
    executeMetaAction.mockResolvedValue({
      success: false, error: 'Gateway timeout', platformStatus: 504, code: 'TIMEOUT',
    });

    const result = await processExecution(makeJob({ attemptsMade: 2, maxAttempts: 3 }));

    expect(result).toEqual({ ok: false });
    const failCall = lifecycleService.transition.mock.calls[1][0];
    expect(failCall.newStatus).toBe('EXECUTED_FAILED');
    expect(failCall.metadata.reason).toBe('max_retries_exceeded');
  });

  it('already terminal → skips without calling lifecycleService', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...BASE_EXECUTION, status: 'EXECUTED_SUCCESS',
    });

    const result = await processExecution(makeJob());

    expect(result).toMatchObject({ skipped: true });
    expect(lifecycleService.transition).not.toHaveBeenCalled();
    expect(executeMetaAction).not.toHaveBeenCalled();
  });

  it('execution not found in DB → skips without error', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(null);

    const result = await processExecution(makeJob());

    expect(result).toMatchObject({ skipped: true, reason: 'not_found' });
    expect(lifecycleService.transition).not.toHaveBeenCalled();
  });

  it('BullMQ retry: already EXECUTING → skips QUEUED→EXECUTING, calls Meta directly', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...BASE_EXECUTION, status: 'EXECUTING', version: 3,
    });
    lifecycleService.transition.mockResolvedValueOnce({ ...BASE_EXECUTION, version: 4 });
    executeMetaAction.mockResolvedValue({ success: true, data: {} });

    const result = await processExecution(makeJob({ attemptsMade: 1 }));

    expect(result).toEqual({ ok: true });
    // Only one transition (EXECUTING → EXECUTED_SUCCESS), not two.
    expect(lifecycleService.transition).toHaveBeenCalledTimes(1);
    expect(lifecycleService.transition.mock.calls[0][0].newStatus).toBe('EXECUTED_SUCCESS');
  });
});
