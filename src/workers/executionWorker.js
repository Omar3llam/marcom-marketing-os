// ============================================================
// MARCOM — Execution Worker (PR #18: Production Runtime Hardening)
// ============================================================
// Consumes the `executions` BullMQ queue.
//
// For each job:
//   1. Read ExecutionRequest from DB.
//   2. If already terminal → skip (idempotency guard).
//   3. Transition QUEUED → EXECUTING via lifecycleService.
//      On BullMQ retries the status is already EXECUTING — skip
//      the QUEUED→EXECUTING step and call Meta API directly.
//   4. Call executeMetaAction().
//   5. On success  → transition EXECUTING → EXECUTED_SUCCESS.
//   6. On failure  → classify error:
//        non-retriable (4xx, auth, config) → transition EXECUTING
//          → EXECUTED_FAILED and return (no throw). Invariant VI-2.
//        retriable (5xx, network, 429) → throw so BullMQ retries.
//          On last attempt → write EXECUTED_FAILED, no re-throw.
//
// Lock renewal: BullMQ's Worker automatically renews the job lock
// every lockDuration/2 ms. No manual extendLock() needed.
//
// Heartbeat: emits a Redis key every HEARTBEAT_INTERVAL_MS.
// vitals.js reads these to surface active worker count.
// ============================================================

import { Worker }           from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { EXECUTION_QUEUE_NAME }        from '../queues/index.js';
import { executeMetaAction }           from '../services/metaExecutionService.js';
import { lifecycleService }            from '../services/execution/ExecutionLifecycleService.js';
import { startHeartbeat }              from '../services/execution/workerHealth.js';
import { stampDecisionExecuted }       from '../services/execution/decisionAttribution.js';
import { prisma }                      from '../lib/prisma.js';
import { logger }                      from '../utils/logger.js';
import {
  ExecutionStatus,
  isTerminalState,
  TransitionActor,
} from '@marcom/runtime-contracts';

const LOCK_DURATION_MS = Number(process.env.BULLMQ_LOCK_DURATION_MS || 30_000);

// ── Error classification ─────────────────────────────────────
// Returns true if the Meta API status code indicates a problem
// that will never succeed on retry (auth, not found, bad input).
// Invariant VI-2: these go straight to dead-letter, no retry.
function isNonRetriable(platformStatus) {
  return (
    platformStatus === 400 ||  // bad request — input won't change
    platformStatus === 401 ||  // unauthorized — token won't fix itself
    platformStatus === 403 ||  // forbidden — permissions won't change
    platformStatus === 404     // not found — target doesn't exist
  );
}

// ── Worker process handler ───────────────────────────────────
async function processExecution(job) {
  const { executionId, workspaceId, userId, actionType, targetId, options = {} } = job.data;

  if (!executionId || !workspaceId) {
    // Malformed job — move to dead-letter without retry.
    throw Object.assign(new Error('executionWorker: missing executionId or workspaceId'), {
      skipRetry: true,
    });
  }

  // ── Read current state ───────────────────────────────────
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
    select: {
      id: true, status: true, version: true,
      actionType: true, targetId: true,
      correlationId: true,
      // R10 (I55) — the decision this mutation carries out, resolved and scoped
      // at request time. Read here so the success path below can stamp it
      // without a second lookup, and so an unattributed execution is visibly
      // null rather than undefined-because-unselected (#209's class).
      decisionId: true,
    },
  });

  if (!execution) {
    logger.warn({ executionId }, '[executionWorker] execution not found — skipping');
    return { skipped: true, reason: 'not_found' };
  }

  // Idempotency guard — a previous worker already reached terminal.
  if (isTerminalState(execution.status)) {
    logger.info({ executionId, status: execution.status }, '[executionWorker] already terminal — skipping');
    return { skipped: true };
  }

  // ── QUEUED → EXECUTING ───────────────────────────────────
  // On the first attempt: status is QUEUED — perform the transition.
  // On BullMQ retries: status is already EXECUTING — skip to Meta call.
  let currentVersion = execution.version;

  if (execution.status === ExecutionStatus.QUEUED) {
    const updated = await lifecycleService.transition({
      executionId,
      newStatus:       ExecutionStatus.EXECUTING,
      expectedVersion: execution.version,
      actor:           TransitionActor.WORKER,
      correlationId:   execution.correlationId ?? executionId,
      metadata:        { workerId: process.pid, attempt: job.attemptsMade + 1 },
    });
    currentVersion = updated.version;
  }

  // ── Call Meta API ────────────────────────────────────────
  const result = await executeMetaAction(
    workspaceId,
    userId,
    actionType  ?? execution.actionType,
    targetId    ?? execution.targetId,
    options,
  );

  if (result.success) {
    await lifecycleService.transition({
      executionId,
      newStatus:       ExecutionStatus.EXECUTED_SUCCESS,
      expectedVersion: currentVersion,
      actor:           TransitionActor.WORKER,
      correlationId:   execution.correlationId ?? executionId,
      metadata: {
        response:  result.data,
        workerId:  process.pid,
      },
    });

    // ── R10 (I55): the platform mutation LANDED ─────────────
    // This is the only place in the system that stamps Decision.executedAt from
    // a real execution, and it is deliberately after the EXECUTED_SUCCESS
    // transition rather than before the Meta call. Queued is not executed;
    // attempted is not executed. Only a mutation Meta accepted means the
    // operator acted, and only that belongs in the accuracy population.
    //
    // Best-effort by design: the ad platform has already changed. Throwing here
    // would make BullMQ retry a job whose side effect is done, and re-run a
    // real budget change to fix a bookkeeping miss. The helper logs at error
    // level instead, because an unstamped decision is exactly the invisibility
    // R10 exists to end.
    const stamp = await stampDecisionExecuted({
      workspaceId,
      decisionId: execution.decisionId,
    });

    logger.info(
      { executionId, actionType: execution.actionType, decisionId: execution.decisionId, stamped: stamp.stamped },
      '[executionWorker] success',
    );
    return { ok: true, decisionStamped: stamp.stamped };
  }

  // ── Failure path ─────────────────────────────────────────
  const maxAttempts  = job.opts?.attempts ?? 1;
  const isLastAttempt = (job.attemptsMade + 1) >= maxAttempts;
  const nonRetriable  = isNonRetriable(result.platformStatus);

  if (nonRetriable || isLastAttempt) {
    // Write EXECUTED_FAILED — no re-throw. Invariant VI-2.
    await lifecycleService.transition({
      executionId,
      newStatus:       ExecutionStatus.EXECUTED_FAILED,
      expectedVersion: currentVersion,
      actor:           TransitionActor.WORKER,
      correlationId:   execution.correlationId ?? executionId,
      metadata: {
        response: { error: result.error, code: result.code },
        reason:   nonRetriable ? 'non_retriable' : 'max_retries_exceeded',
        workerId: process.pid,
        platformStatus: result.platformStatus,
      },
    });

    logger.warn({
      executionId, nonRetriable, isLastAttempt,
      platformStatus: result.platformStatus,
    }, '[executionWorker] terminal failure');

    return { ok: false };
  }

  // Retriable — throw so BullMQ schedules the next attempt.
  // State stays EXECUTING; the next attempt detects this and
  // skips the QUEUED→EXECUTING transition. Invariant IV-2.
  const err = new Error(result.error || 'Meta API call failed (retriable)');
  err.platformStatus = result.platformStatus;
  logger.warn({
    executionId,
    platformStatus: result.platformStatus,
    attempt:        job.attemptsMade + 1,
  }, '[executionWorker] retriable failure — will retry');
  throw err;
}

// ── Worker factory ───────────────────────────────────────────
export function startExecutionWorker() {
  const concurrency = Number(process.env.BULLMQ_EXECUTION_CONCURRENCY || 3);
  const heartbeat   = startHeartbeat();

  const worker = new Worker(
    EXECUTION_QUEUE_NAME,
    processExecution,
    {
      connection:   bullConnection,
      prefix:       QUEUE_PREFIX,
      concurrency,
      lockDuration: LOCK_DURATION_MS,
      // BullMQ auto-renews the lock every lockDuration/2 ms.
      // No manual extendLock() needed. Invariant V-2.
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({
      jobId:       job?.id,
      executionId: job?.data?.executionId,
      err:         err.message,
      attempt:     job?.attemptsMade,
    }, '[executionWorker] job failed');
  });

  worker.on('completed', (job) => {
    logger.debug({
      jobId:       job.id,
      executionId: job?.data?.executionId,
    }, '[executionWorker] job completed');
  });

  // Stop heartbeat when worker closes (SIGTERM).
  worker.on('closing', () => heartbeat.stop());

  logger.info({ concurrency, lockDuration: LOCK_DURATION_MS }, '[executionWorker] started');
  return worker;
}
