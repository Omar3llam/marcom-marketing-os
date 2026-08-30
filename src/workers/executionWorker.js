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
import { loadExecutability }           from '../services/execution/decisionEligibility.js';
import { assertExecutionSchemaReady }  from '../services/execution/schemaReadiness.js';
import { validateMutationParams }      from '../services/meta/mutationParams.js';
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

  // ── B5-01R‴: is this database new enough for this code? ──
  //
  // FIRST, before any read, any transition, and any platform call. render.yaml
  // deploys lumi-backend and lumi-worker independently with no dependsOn, and
  // the worker's build is the shorter of the two (no migration, no client
  // bundle) — so a worker running ahead of the schema is the DEFAULT on every
  // deploy, not an unlucky race.
  //
  // Until now that was survivable only by accident: a full-row Prisma read
  // happened to throw first. B5-01R measured what a narrowed read does instead —
  // two real platform mutations across three attempts. This makes the refusal
  // intentional, and independent of how any Prisma read is projected.
  //
  // Deliberately NOT `skipRetry`: this is the one failure here that is expected
  // to stop being true on its own, the moment the backend's migration lands. It
  // throws like any other retriable error, so BullMQ's existing policy (attempts
  // + exponential backoff, set in enqueueExecution) decides what happens to the
  // job — the same policy that already governed this exact skew before the gate
  // existed. No new queue semantics are introduced here.
  await assertExecutionSchemaReady();

  // ── Read current state ───────────────────────────────────
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
    select: {
      id: true, status: true, version: true,
      actionType: true, targetId: true,
      correlationId: true,
      // R11 (I67) — the authoritative workspace and the authoritative options.
      // Neither was selected before, so neither could be checked: the worker
      // took the workspace from the JOB (which chose which credential to use)
      // and the options from the JOB ONLY — they were never persisted anywhere
      // the worker read. `payload` is the original request body, written at
      // creation time by a route that had already authorized it.
      workspaceId: true,
      payload: true,
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

  // ── R11 (I67): re-authorize against persisted state ──────
  //
  // The worker used to trust the job for everything that mattered. It never
  // compared `job.data.workspaceId` to the row's — and that value chose which
  // workspace's Meta credential to resolve. It read
  // `actionType ?? execution.actionType` and `targetId ?? execution.targetId`,
  // so the JOB WON over the row it was supposed to be carrying out. And
  // `options` came from the job alone, never persisted, never validated
  // against anything.
  //
  // A queue payload is not an authorization. The row is the record of what a
  // route authorized; the job carries an identifier to find it. Where the two
  // disagree the job is wrong by definition, and this refuses rather than
  // guessing which one to believe.
  if (execution.workspaceId !== workspaceId) {
    logger.error({
      executionId,
      jobWorkspaceId: workspaceId,
      rowWorkspaceId: execution.workspaceId,
    }, '[executionWorker] REFUSING — job workspace disagrees with the persisted execution');
    throw Object.assign(new Error('executionWorker: job/row workspace mismatch'), { skipRetry: true });
  }

  for (const [field, jobValue] of [['actionType', actionType], ['targetId', targetId]]) {
    if (jobValue !== undefined && jobValue !== null && jobValue !== execution[field]) {
      logger.error({
        executionId, field, rowValue: execution[field],
      }, '[executionWorker] REFUSING — job parameter disagrees with the persisted execution');
      throw Object.assign(new Error(`executionWorker: job/row ${field} mismatch`), { skipRetry: true });
    }
  }

  // Idempotency guard — a previous worker already reached terminal.
  if (isTerminalState(execution.status)) {
    logger.info({ executionId, status: execution.status }, '[executionWorker] already terminal — skipping');
    return { skipped: true };
  }

  // Derive the mutation from the ROW, and re-validate it. The route validated
  // this same shape at request time; validating again here costs one pure
  // function call and means the worker is not relying on a check that happened
  // in a different process, minutes earlier, on a different entry path.
  const persistedOptions = (execution.payload && typeof execution.payload === 'object')
    ? (execution.payload.options ?? {})
    : {};

  const invalidParams = validateMutationParams({
    actionType:  execution.actionType,
    targetId:    execution.targetId,
    targetType:  execution.payload?.targetType,
    options:     persistedOptions,
  });
  if (invalidParams) {
    logger.error({ executionId, reason: invalidParams }, '[executionWorker] REFUSING — persisted mutation parameters are not valid');
    await lifecycleService.transition({
      executionId,
      newStatus:       ExecutionStatus.EXECUTED_FAILED,
      expectedVersion: execution.version,
      actor:           TransitionActor.WORKER,
      correlationId:   execution.correlationId ?? executionId,
      metadata:        { reason: 'invalid_parameters', detail: invalidParams, workerId: process.pid },
    });
    return { ok: false, reason: 'invalid_parameters' };
  }

  // ── B4-A (D2 · §6): is the decision STILL executable? ────
  //
  // The route checked this before creating the row. That check has since gone
  // stale: a request can sit in the queue while the sweep supersedes the
  // decision or an operator dismisses it, and without this the mutation still
  // lands — against a call nobody stands behind, looking exactly like a
  // legitimate one. The route's answer is about request time; this is about
  // mutation time, and only the second one is load-bearing.
  //
  // Read fresh from the database rather than from the row or the job, both of
  // which were written before the queue wait. Same rule object as the route, so
  // the two moments cannot disagree about what "executable" means.
  //
  // CANCELLED, not EXECUTED_FAILED: nothing was attempted and Meta refused
  // nothing. Recording a platform failure here would put a fabricated refusal
  // in the audit and let a retry look reasonable.
  if (execution.decisionId) {
    const { executable, reason } = await loadExecutability(execution.workspaceId, execution.decisionId);
    if (!executable) {
      logger.warn({
        executionId, decisionId: execution.decisionId, reason,
      }, '[executionWorker] REFUSING — decision is no longer executable');
      await lifecycleService.transition({
        executionId,
        newStatus:       ExecutionStatus.CANCELLED,
        expectedVersion: execution.version,
        actor:           TransitionActor.WORKER,
        correlationId:   execution.correlationId ?? executionId,
        metadata:        { reason: `decision_not_executable:${reason}`, workerId: process.pid },
      });
      return { ok: false, reason: 'decision_not_executable', detail: reason };
    }
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
  // Every parameter comes from the persisted row, which the checks above have
  // just proven the job agrees with.
  const result = await executeMetaAction(
    execution.workspaceId,
    userId,
    execution.actionType,
    execution.targetId,
    persistedOptions,
  );

  if (result.success) {
    const succeeded = await lifecycleService.transition({
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
    // This is the only place in the system that stamps
    // Decision.platformExecutedAt, and it is deliberately after the EXECUTED_SUCCESS

    // transition rather than before the Meta call. Queued is not executed;
    // attempted is not executed. Only a mutation Meta accepted means the
    // operator acted, and only that belongs in the accuracy population.
    //
    // Best-effort by design: the ad platform has already changed. Throwing here
    // would make BullMQ retry a job whose side effect is done, and re-run a
    // real budget change to fix a bookkeeping miss. The helper logs at error
    // level instead, because an unstamped decision is exactly the invisibility
    // R10 exists to end.
    // B4-A — the timestamp is the LIFECYCLE's, not a fresh clock reading.
    // `updatedAt` on the row the transition just returned is the instant
    // EXECUTED_SUCCESS was persisted, which is the authoritative event time the
    // transition log already owns. Calling `new Date()` here would mint a
    // second, slightly later instant for the same event and leave the two
    // disagreeing by however long the write took.
    const stamp = await stampDecisionExecuted({
      workspaceId,
      decisionId: execution.decisionId,
      at:         succeeded?.updatedAt ?? undefined,
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
