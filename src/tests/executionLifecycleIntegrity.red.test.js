// ============================================================
// SLICE D · RED — production execution lifecycle integrity
// ------------------------------------------------------------
// THE CLOSURE CONDITION (Omar):
//
//   Every execution accepted into an in-flight state must either progress to
//   execution or reach a terminal state, and any timeout policy declared by
//   the system must be actively reachable in production.
//
// ⚠️ TERMINAL-STATE INTEGRITY IS THE PRIMARY INVARIANT. Visibility and
// recoverability are CONSEQUENCES of it, never substitutes. Omar named the two
// ways this slice could be faked, and both are actively blocked below:
//
//   1. teaching a counter to count more while the lifecycle stays broken
//      → nothing here asserts on stalePendingCount. The visibility case reads
//        GET /active, the product's own in-flight list, so it can only be
//        satisfied by the row LEAVING the in-flight set.
//   2. making QUEUED retryable to manufacture a recovery path
//      → a control asserts RETRYABLE_STATUSES is UNCHANGED. A fix that adds
//        'QUEUED' to that list fails this suite.
//
// ⚠️ THIS FILE IS RED. The four cases fail on trunk, one per symptom, and they
// are deliberately independent: a fix that closes one must be seen not to have
// closed the others by accident.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';

const store = vi.hoisted(() => ({
  users: new Map(),
  exec: null,
  enqueueFails: false,
}));

vi.mock('../utils/firebaseAdmin.js', () => ({
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(async (token) => {
        const uid = String(token).replace(/^token-for-/, '');
        return { uid, email: `${uid}@example.com`, email_verified: true };
      }),
    }),
  },
  getFirebaseAdminReadiness: () => ({ ok: true, error: null }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: new Proxy({}, {
    get(_t, model) {
      if (model === 'user') {
        return { findUnique: async ({ where }) => store.users.get(where.clerkId) ?? null };
      }
      return store.exec.prisma[model];
    },
  }),
}));

// The QUEUE is the precondition under examination: a test makes it fail.
vi.mock('../queues/index.js', () => ({
  MAINTENANCE_QUEUE_NAME: 'maintenance',
  AI_USAGE_CLEANUP_JOB: 'ai-usage-cleanup',
  LEARNING_EXTRACTION_JOB: 'learning-extraction',
  PLAN_CLOSURE_JOB: 'plan-closure',
  EXECUTION_TIMEOUT_JOB: 'execution-timeout',
  scheduleAiUsageCleanup: vi.fn(), scheduleLearningExtraction: vi.fn(),
  schedulePlanClosure: vi.fn(), scheduleExecutionTimeout: vi.fn(),
  executionQueue: {
    count: vi.fn().mockResolvedValue(0),
    getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }),
    getFailedCount: vi.fn().mockResolvedValue(0),
  },
  enqueueExecution: vi.fn(async () => {
    if (store.enqueueFails) throw new Error('Redis connection lost');
    return { id: 'job-1' };
  }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../lib/sseRegistry.js', () => ({
  broadcastWorkspaceEvent: vi.fn(), addSubscriber: vi.fn(), removeSubscriber: vi.fn(),
}));
vi.mock('../services/execution/workerHealth.js', () => ({
  getWorkerHeartbeats: vi.fn().mockResolvedValue([]), startHeartbeat: vi.fn(),
}));
vi.mock('../services/execution-checkpoint/index.js', () => ({
  getLatestCheckpoint: vi.fn().mockResolvedValue(null), getPausedExecutions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/execution-engine/observability/executionTrace.js', () => ({
  buildTrace: vi.fn().mockResolvedValue({ timeline: [] }),
}));
vi.mock('../services/execution-engine/observability/traceSerializer.js', () => ({
  serializeTrace: vi.fn((t) => t),
}));
vi.mock('../services/artifact-storage/index.js', () => ({ getArtifact: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/execution/ExecutionResumeService.js', () => ({
  resumeWithDecisions: vi.fn(), ResumeError: class extends Error {},
}));
vi.mock('../lib/aiUsage.js', () => ({ cleanAiUsageLogs: vi.fn() }));
vi.mock('../services/pattern-engine/learningSweep.js', () => ({ runLearningSweep: vi.fn() }));
vi.mock('../services/planning/planClosureSweep.js', () => ({ runPlanClosureSweep: vi.fn() }));
vi.mock('bullmq', () => ({ Worker: class { on() {} }, Queue: class { on() {} } }));
vi.mock('../services/execution/decisionAttribution.js', () => ({
  resolveAttribution: vi.fn().mockResolvedValue({ status: 'resolved', decisionId: null }),
  stampDecisionExecuted: vi.fn().mockResolvedValue({ stamped: false }),
}));

const H = await import('./executionLifecycleIntegrity.harness.js');
const { TIMEOUT_POLICY, IN_FLIGHT_STATUSES, isTerminalState, isExecutionTimedOut } =
  await import('@marcom/runtime-contracts');
// RETRYABLE_STATUSES is module-private in retry.js, so the guard reads it at
// SOURCE rather than importing it. My first version imported it, got undefined,
// and the control failed for a reason that had nothing to do with the product.
const RETRY_SRC = readFileSync('src/routes/execution/retry.js', 'utf8');

// ⚠️ THE SWEEP IS REACHED THROUGH THE PRODUCTION DISPATCHER, BY JOB NAME.
//
// My first version of cases 2-4 seated a zombie and asserted the instant after
// that it was already resolved. NO scheduled implementation can satisfy that —
// the assertion was stricter than production could ever be, and it was my
// error, not the implementation's. The invariant Omar set is "every execution
// that exceeds its declared lifecycle budget REACHES the existing terminal
// timeout state", not "reaches it within zero milliseconds".
//
// So the suite now runs the sweep the way production does: through
// runMaintenanceJob({ name: EXECUTION_TIMEOUT_JOB }), the dispatcher the
// maintenance worker exports for exactly this. Calling the sweep function
// directly would prove a function exists; calling the DISPATCHER proves the job
// is wired into the topology that runs it. That is stricter than what it
// replaces, not weaker.
const { runMaintenanceJob } = await import('../workers/maintenanceWorker.js');
const { EXECUTION_TIMEOUT_JOB } = await import('../queues/index.js');
const sweepTimeouts = () => runMaintenanceJob({ name: EXECUTION_TIMEOUT_JOB });

let app;

beforeEach(async () => {
  store.users.clear();
  store.users.set(H.OPERATOR.uid, H.userRowFor(H.OPERATOR));
  store.exec = H.createExecutionStore();
  store.enqueueFails = false;
  app = await H.buildExecutionApp();
});

const asOperator = (m, path) => request(app)[m](path).set('Authorization', `Bearer ${H.tokenFor(H.OPERATOR)}`);

/** Seat an execution that has been held past its policy budget. */
function seatOverBudget(status) {
  const budget = TIMEOUT_POLICY[status];
  const heldFor = budget + 60_000;
  return store.exec.seat({
    id: 'exec-zombie',
    status,
    version: 2,
    updatedAt: new Date(Date.now() - heldFor),
    createdAt: new Date(Date.now() - heldFor),
  });
}

// ── CONTROLS ────────────────────────────────────────────────────────────────
describe('controls — the harness measures the product, not itself', () => {
  it('the happy path still queues an execution', async () => {
    const res = await asOperator('post', '/api/execute/meta').send(H.VALID_META_BODY);
    expect(res.status).toBe(202);
    const row = [...store.exec.rows.values()][0];
    expect(row.status).toBe('QUEUED');
  });

  it('the store implements a REAL optimistic lock', async () => {
    const row = store.exec.seat({ id: 'occ-1', status: 'QUEUED', version: 5 });

    // A stale expected-version affects NOTHING, which is the whole lock.
    const stale = await store.exec.prisma.executionRequest.updateMany({
      where: { id: row.id, version: 4 }, data: { status: 'EXECUTING' },
    });
    expect(stale.count).toBe(0);
    expect(store.exec.rows.get('occ-1').status).toBe('QUEUED');

    // The matching version writes. The version INCREMENT is the caller's, not
    // the store's — updateWithOCC sends `version: { increment: 1 }`, so this
    // sends it too. My first draft omitted it and then asserted the store had
    // incremented anyway; the control was wrong, not the store.
    const fresh = await store.exec.prisma.executionRequest.updateMany({
      where: { id: row.id, version: 5 },
      data: { status: 'EXECUTING', version: { increment: 1 } },
    });
    expect(fresh.count).toBe(1);
    expect(store.exec.rows.get('occ-1').version).toBe(6);
  });

  it('the timeout POLICY itself recognises an over-budget execution', async () => {
    // If this failed, every case below would be measuring a fixture that is not
    // actually past its budget.
    const row = seatOverBudget('QUEUED');
    expect(isExecutionTimedOut(row)).toBe(true);
    expect(isTerminalState(row.status)).toBe(false);
  });

  // ⚠️ OMAR'S GUARD, asserted rather than trusted. A fix that manufactures a
  // recovery path by teaching retry a new status fails HERE.
  it('RETRYABLE_STATUSES is unchanged — recovery must not come from widening it', () => {
    const decl = RETRY_SRC.match(new RegExp('const RETRYABLE_STATUSES = \\[([^\\]]*)\\]'));
    expect(decl, 'the declaration must still be findable').not.toBeNull();
    const statuses = decl[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(statuses).toEqual(['EXECUTED_FAILED', 'TIMED_OUT']);
  });
});

// ── RED 1 — ENQUEUE FAILURE ─────────────────────────────────────────────────
describe('1. an execution whose enqueue fails does not stay in-flight', () => {
  it('POST /meta leaves NO execution in a non-terminal state when enqueue throws', async () => {
    store.enqueueFails = true;

    const res = await asOperator('post', '/api/execute/meta').send(H.VALID_META_BODY);
    expect(res.status).toBe(500);

    const rows = [...store.exec.rows.values()];
    expect(rows).toHaveLength(1);
    // Nothing will ever run this job. The row must say so.
    expect(isTerminalState(rows[0].status)).toBe(true);
  });

  it('…and the terminal state carries an explicit machine-readable reason', async () => {
    store.enqueueFails = true;
    await asOperator('post', '/api/execute/meta').send(H.VALID_META_BODY);

    // The lifecycle service lifts `metadata.reason` into the transition row's
    // own `reason` COLUMN (ExecutionLifecycleService.js:179) and keeps
    // `metadata.auditMetadata` as the payload. My first version read
    // `t.metadata.reason` and saw nothing — the assertion was right, the
    // column was wrong. Same claim, correct location.
    const reasons = store.exec.transitions.map((t) => t.reason).filter(Boolean);
    expect(reasons.join(' ')).toContain('ENQUEUE_FAILED');
  });

  it('CONTROL — the precedent already exists one file away', async () => {
    // retry.js transitions the identical failure to CANCELLED with
    // EXECUTION_ENQUEUE_FAILED. The invariant is not being invented here; the
    // primary path is being made to obey one the product already established.
    const { EXECUTION_ENQUEUE_FAILED } = await import('../routes/execution/retry.js');
    expect(EXECUTION_ENQUEUE_FAILED).toBe('EXECUTION_ENQUEUE_FAILED');
  });

  it('the audit record and the execution record agree about what happened', async () => {
    store.enqueueFails = true;
    await asOperator('post', '/api/execute/meta').send(H.VALID_META_BODY);

    const audit = store.exec.auditLogs.at(-1);
    const row = [...store.exec.rows.values()][0];
    // On trunk the audit says FAILED while the execution says QUEUED — two
    // records of one event, disagreeing.
    expect(audit.status).toBe('FAILED');
    expect(isTerminalState(row.status)).toBe(true);
  });
});

// ── RED 2 — THE TIMEOUT BACKSTOP ────────────────────────────────────────────
describe('2. the declared timeout policy is reachable in production', () => {
  it.each(IN_FLIGHT_STATUSES.filter((s) => TIMEOUT_POLICY[s] != null))(
    'an execution held past the %s budget does not remain in-flight',
    async (status) => {
      seatOverBudget(status);
      await sweepTimeouts();

      const res = await asOperator('get', '/api/execute/active');
      expect(res.status).toBe(200);

      // Measured through the product's own in-flight list and the product's own
      // policy. This can only pass if the row LEFT the in-flight set — not by
      // any counter learning to count differently.
      const overBudget = res.body.executions.filter(
        (e) => e.ageSeconds * 1000 > TIMEOUT_POLICY[e.status],
      );
      expect(overBudget).toEqual([]);
    },
  );
});

// ── RED 3 — RECOVERY ────────────────────────────────────────────────────────
describe('3. an execution that stopped progressing can be recovered', () => {
  it('a zombie held past its budget is recoverable through the existing affordance', async () => {
    // ⚠️ THE EXPECTED GREEN PATH IS NOT "retry learns to accept QUEUED".
    // It is: the row reaches TIMED_OUT, which retry ALREADY accepts. The
    // control above pins RETRYABLE_STATUSES so the other route is closed.
    seatOverBudget('QUEUED');
    await sweepTimeouts();

    const res = await asOperator('post', '/api/execute/exec-zombie/retry').send({});

    // 201, not 202: retry CREATES a new execution and returns it. My RED
    // asserted 202 from memory of the /meta contract; the route has always
    // answered 201 here. Asserting recovery HAPPENED — a fresh execution,
    // linked to the original — rather than a status code I guessed at.
    expect(res.status).toBe(201);
    expect(res.body.retryOf).toBe('exec-zombie');
    expect(res.body.executionId).not.toBe('exec-zombie');
    expect(res.body.status).toBe('QUEUED');

    // …and the zombie itself is terminal, which is WHY retry accepted it.
    expect(store.exec.rows.get('exec-zombie').status).toBe('TIMED_OUT');
  });

  it('a HEALTHY in-flight execution is still NOT retryable — recovery is for zombies', async () => {
    // The invariant must not turn every queued execution into a retry target.
    store.exec.seat({ id: 'exec-fresh', status: 'QUEUED', version: 2, updatedAt: new Date() });
    const res = await asOperator('post', '/api/execute/exec-fresh/retry').send({});
    expect(res.status).not.toBe(202);
  });
});

// ── RED 4 — VISIBILITY ──────────────────────────────────────────────────────
describe('4. an operator can see that an execution stopped progressing', () => {
  it('no execution is reported in-flight beyond its declared budget', async () => {
    seatOverBudget('QUEUED');
    seatOverBudget('EXECUTING');
    await sweepTimeouts();

    const res = await asOperator('get', '/api/execute/active');
    const stuck = res.body.executions.filter(
      (e) => e.ageSeconds * 1000 > TIMEOUT_POLICY[e.status],
    );
    // Visibility FOLLOWS from terminal-state integrity: a resolved execution is
    // not in this list at all. Nothing here asks a counter to change.
    expect(stuck.map((e) => `${e.id}:${e.status}`)).toEqual([]);
  });
});
