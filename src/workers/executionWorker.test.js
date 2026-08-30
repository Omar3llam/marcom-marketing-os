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

// B5-01R‴ — the schema readiness gate is a seam here, not a subject. It reads
// `_prisma_migrations` with raw SQL, which the substituted prisma below does not
// implement; unmocked it would (correctly, per its fail-closed rule) refuse every
// job in this file. Its own behaviour — refusal under a lagging database, zero
// provider calls, fail-closed when the check cannot run — is proven against a
// real database in src/tests/executionReadinessGate.test.js.
vi.mock('../services/execution/schemaReadiness.js', () => ({
  assertExecutionSchemaReady: vi.fn(async () => {}),
}));

// R10 — the attribution seam is mocked so these tests assert WHEN the worker
// calls it, which is the whole lifecycle rule. Its own behaviour (first-success,
// no-overturn, idempotent) is proven in decisionAttribution.test.js.
vi.mock('../services/execution/decisionAttribution.js', () => ({
  stampDecisionExecuted: vi.fn().mockResolvedValue({ stamped: true, reason: 'STAMPED' }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: { findUnique: vi.fn() },
    // B4-A — the worker re-reads the Decision immediately before the platform
    // call to confirm it is STILL executable (a queued request can outlive a
    // dismissal or a supersession). Defaults to a live decision so the existing
    // cases exercise the success path; the D2 suite overrides it per test.
    decision: { findFirst: vi.fn(async () => ({ id: 'dec-1', status: 'PROPOSED', dismissedAt: null })) },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ────────────────────────────────────
import { executeMetaAction }  from '../services/metaExecutionService.js';
import { lifecycleService }   from '../services/execution/ExecutionLifecycleService.js';
import { prisma }             from '../lib/prisma.js';
import { stampDecisionExecuted } from '../services/execution/decisionAttribution.js';

// ── Test helpers ─────────────────────────────────────────────
const EXECUTION_ID  = 'exec-worker-test-1';
const WORKSPACE_ID  = 'ws-worker-1';
const USER_ID       = 'user-1';
// R11 (I67): targetId is format-validated now — it must look like a Meta object
// id, because it is interpolated into the Graph API request path.
const TARGET_ID     = '120200000000001';

function makeJob({ attemptsMade = 0, maxAttempts = 3 } = {}) {
  return {
    data: {
      executionId: EXECUTION_ID,
      workspaceId: WORKSPACE_ID,
      userId:      USER_ID,
      actionType:  'PAUSE_CAMPAIGN',
      targetId:    TARGET_ID,
      options:     {},
    },
    attemptsMade,
    opts: { attempts: maxAttempts },
  };
}

// R11 (I67): the worker re-authorizes the job against the ROW and derives every
// mutation parameter from it, so the fixture carries the authoritative
// workspace and the persisted request body — not just the fields the job used
// to be trusted for.
const BASE_EXECUTION = {
  id:            EXECUTION_ID,
  workspaceId:   WORKSPACE_ID,
  status:        'QUEUED',
  version:       2,
  actionType:    'PAUSE_CAMPAIGN',
  targetId:      TARGET_ID,
  payload:       { actionType: 'PAUSE_CAMPAIGN', targetId: TARGET_ID, targetType: 'campaign', options: {} },
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

    // R10 added `decisionStamped` to the success envelope; matched rather than
    // compared whole so the envelope can grow without re-writing the assertion
    // that this test is actually about (the two transitions, below).
    expect(result).toMatchObject({ ok: true });
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

    // R10 added `decisionStamped` to the success return, so the shape is
    // matched rather than compared whole — the assertion that matters here is
    // the transition count, not the envelope.
    expect(result).toMatchObject({ ok: true });
    // Only one transition (EXECUTING → EXECUTED_SUCCESS), not two.
    expect(lifecycleService.transition).toHaveBeenCalledTimes(1);
    expect(lifecycleService.transition.mock.calls[0][0].newStatus).toBe('EXECUTED_SUCCESS');
  });
});

// ============================================================
// R10 · Phase A — the worker is the ONLY thing that turns a real platform
// mutation into Decision.platformExecutedAt. These controls pin WHEN it does that.
// ============================================================
describe('R10 · execution attribution (I55)', () => {
  const ATTRIBUTED = { ...BASE_EXECUTION, decisionId: 'dec-1' };

  // NC30 — a successful Meta mutation stamps the originating decision. Delete
  // the stampDecisionExecuted call from the success branch and this fails; the
  // Proof Engine then never sees a single Lumi-executed decision again, exactly
  // as before R10, and no other test in the repo notices.
  it('NC30 · stamps the decision after a SUCCESSFUL platform mutation', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({ success: true, data: { id: 'camp-1' } });

    const result = await processExecution(makeJob());

    expect(stampDecisionExecuted).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      decisionId:  'dec-1',
    });
    expect(result).toMatchObject({ ok: true, decisionStamped: true });
  });

  // NC29 — the control that protects the population's meaning. Move the stamp
  // above the `if (result.success)` branch, or into the QUEUED→EXECUTING
  // transition, and this fails: a decision whose Meta call was REJECTED would
  // enter the accuracy population as an executed intervention, and its
  // "outcome" would be the effect of an action nobody took.
  it('NC29 · does NOT stamp when the platform mutation FAILS (non-retriable)', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({
      success: false, error: 'Invalid parameter', code: 100, platformStatus: 400,
    });

    await processExecution(makeJob());

    expect(stampDecisionExecuted).not.toHaveBeenCalled();
  });

  it('NC29b · does NOT stamp on a retriable failure that will be retried', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({
      success: false, error: 'rate limited', code: 17, platformStatus: 429,
    });

    await expect(processExecution(makeJob({ attemptsMade: 0, maxAttempts: 3 }))).rejects.toThrow();
    expect(stampDecisionExecuted).not.toHaveBeenCalled();
  });

  it('NC29c · does NOT stamp on the final failed attempt', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({
      success: false, error: 'server error', code: 2, platformStatus: 500,
    });

    await processExecution(makeJob({ attemptsMade: 2, maxAttempts: 3 }));

    expect(stampDecisionExecuted).not.toHaveBeenCalled();
  });

  // Queued is not executed. A terminal-state skip performs no mutation, so it
  // must not claim one — this is the path a duplicated BullMQ job takes.
  it('does not stamp when the execution was already terminal (no mutation ran)', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      ...ATTRIBUTED, status: 'EXECUTED_SUCCESS',
    });

    await processExecution(makeJob());

    expect(executeMetaAction).not.toHaveBeenCalled();
    expect(stampDecisionExecuted).not.toHaveBeenCalled();
  });

  // An unattributed execution is a normal state, not an error: the worker still
  // calls the seam, which is what centralises the NOT_ATTRIBUTED accounting
  // rather than scattering `if (decisionId)` across call sites.
  it('passes a null decisionId through for an unattributed execution', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({ ...BASE_EXECUTION, decisionId: null });
    lifecycleService.transition.mockResolvedValue({ ...BASE_EXECUTION, version: 3 });
    executeMetaAction.mockResolvedValue({ success: true, data: {} });
    stampDecisionExecuted.mockResolvedValueOnce({ stamped: false, reason: 'NOT_ATTRIBUTED' });

    const result = await processExecution(makeJob());

    expect(stampDecisionExecuted).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, decisionId: null });
    expect(result).toMatchObject({ ok: true, decisionStamped: false });
  });

  // The worker must SELECT decisionId. An unselected column is `undefined`, the
  // stamp silently becomes a no-op, and every execution goes unattributed with
  // nothing to show for it — the #209 class, applied to attribution.
  it('selects decisionId when reading the execution row', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({ success: true, data: {} });

    await processExecution(makeJob());

    expect(prisma.executionRequest.findUnique.mock.calls[0][0].select)
      .toHaveProperty('decisionId', true);
  });

  // A stamp failure must not fail the job: the ad platform has already changed,
  // and a throw here would make BullMQ re-run a real budget mutation.
  it('a stamping failure never fails the job', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(ATTRIBUTED);
    lifecycleService.transition.mockResolvedValue({ ...ATTRIBUTED, version: 3 });
    executeMetaAction.mockResolvedValue({ success: true, data: {} });
    stampDecisionExecuted.mockResolvedValueOnce({ stamped: false, reason: 'ERROR' });

    await expect(processExecution(makeJob())).resolves.toMatchObject({ ok: true });
  });
});
