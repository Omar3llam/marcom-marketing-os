// ============================================================
// R11-D — the worker re-authorizes against persisted state  (I67)
// ------------------------------------------------------------
// The worker trusted the job for everything that mattered:
//
//   * `execution.workspaceId` was neither selected nor compared, while
//     `job.data.workspaceId` chose which workspace's Meta credential to use;
//   * `actionType ?? execution.actionType` and `targetId ?? execution.targetId`
//     let the JOB WIN over the row it was supposed to be carrying out;
//   * `options` existed only in the job — never persisted, never validated.
//
// A queue payload is not an authorization. Each control here fails if the
// worker goes back to believing one.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: { executionRequest: { findUnique: vi.fn() } },
}));
vi.mock('../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn().mockResolvedValue({ success: true, data: { ok: true }, platformStatus: 200 }),
}));
vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { transition: vi.fn().mockResolvedValue({ version: 3 }) },
}));
vi.mock('../services/execution/workerHealth.js', () => ({ startHeartbeat: () => ({ stop: vi.fn() }) }));
vi.mock('../services/execution/decisionAttribution.js', () => ({
  stampDecisionExecuted: vi.fn().mockResolvedValue({ stamped: false }),
}));
vi.mock('../queues/connection.js', () => ({ bullConnection: {}, QUEUE_PREFIX: 'test', REDIS_DISABLED: false }));
vi.mock('../queues/index.js', () => ({ EXECUTION_QUEUE_NAME: 'executions' }));

// processExecution is module-private; the Worker constructor receives it, so a
// capturing Worker mock is how the handler is reached (same approach as
// executionWorker.test.js).
let capturedProcessor = null;
vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name, processor) { capturedProcessor = processor; }
    on() { return this; }
    close() {}
  },
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { executeMetaAction } from '../services/metaExecutionService.js';
import { lifecycleService } from '../services/execution/ExecutionLifecycleService.js';

const EXEC_ID   = 'exec-1';
const WS_MINE   = 'ws-mine';
const TARGET    = '120200000000001';

const ROW = {
  id: EXEC_ID,
  workspaceId: WS_MINE,
  status: 'QUEUED',
  version: 2,
  actionType: 'PAUSE_CAMPAIGN',
  targetId: TARGET,
  payload: { actionType: 'PAUSE_CAMPAIGN', targetId: TARGET, targetType: 'campaign', options: {} },
  correlationId: 'c-1',
  decisionId: null,
};

function job(overrides = {}) {
  return {
    data: { executionId: EXEC_ID, workspaceId: WS_MINE, userId: 'u1', ...overrides },
    attemptsMade: 0,
    opts: { attempts: 3 },
  };
}

let processExecution;
beforeEach(async () => {
  vi.clearAllMocks();
  capturedProcessor = null;
  executeMetaAction.mockResolvedValue({ success: true, data: { ok: true }, platformStatus: 200 });
  lifecycleService.transition.mockResolvedValue({ version: 3 });
  const { startExecutionWorker } = await import('./executionWorker.js');
  startExecutionWorker();
  processExecution = capturedProcessor;
});

describe('the job carries identifiers; the row carries the mutation (I67)', () => {
  it('executes using the ROW\'s parameters', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ROW);

    await processExecution(job({ actionType: 'PAUSE_CAMPAIGN', targetId: TARGET }));

    expect(executeMetaAction).toHaveBeenCalledWith(WS_MINE, 'u1', 'PAUSE_CAMPAIGN', TARGET, {});
  });

  it('reads options from the PERSISTED payload, not from the job', async () => {
    // options never existed anywhere but the job before R11, so a job could
    // carry Graph API fields the route had never seen.
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...ROW,
      actionType: 'OPTIMIZE_CAMPAIGN',
      payload: { targetType: 'campaign', options: { status: 'PAUSED' } },
    });

    await processExecution(job({ options: { status: 'ACTIVE', name: 'renamed' } }));

    expect(executeMetaAction).toHaveBeenCalledWith(
      WS_MINE, 'u1', 'OPTIMIZE_CAMPAIGN', TARGET, { status: 'PAUSED' },
    );
  });

  // ── NC-H1 · the control ────────────────────────────────────
  it('REFUSES when the job names a different workspace than the row', async () => {
    // This is the one that chose the credential.
    prisma.executionRequest.findUnique.mockResolvedValue(ROW);

    await expect(processExecution(job({ workspaceId: 'ws-someone-else' })))
      .rejects.toThrow(/workspace mismatch/);

    expect(executeMetaAction).not.toHaveBeenCalled();
  });

  // ── NC-H2 · the control ────────────────────────────────────
  it('REFUSES when the job names a different targetId than the row', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ROW);

    await expect(processExecution(job({ targetId: '120299999999999' })))
      .rejects.toThrow(/targetId mismatch/);

    expect(executeMetaAction).not.toHaveBeenCalled();
  });

  it('REFUSES when the job names a different actionType than the row', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ROW);

    await expect(processExecution(job({ actionType: 'INCREASE_BUDGET' })))
      .rejects.toThrow(/actionType mismatch/);

    expect(executeMetaAction).not.toHaveBeenCalled();
  });

  it('does not retry a mismatched job — a disagreement will not resolve itself', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ROW);
    const err = await processExecution(job({ workspaceId: 'ws-other' })).catch((e) => e);
    expect(err.skipRetry).toBe(true);
  });

  it('FAILS the execution rather than calling Meta when the persisted parameters are invalid', async () => {
    // Belt and braces: the route validated this shape at request time, but the
    // worker is a separate entry path and does not rely on a check that
    // happened in another process.
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...ROW,
      targetId: '123&status=ACTIVE',
      payload: { targetType: 'campaign', options: {} },
    });

    const out = await processExecution(job());

    expect(executeMetaAction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, reason: 'invalid_parameters' });
    expect(lifecycleService.transition).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'EXECUTED_FAILED' }),
    );
  });
});
