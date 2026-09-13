// ============================================================
// POST /api/execute/:id/retry — Clone failed execution + queue
// ============================================================
// Clones a failed execution into a new ExecutionRequest in QUEUED
// status. Powers the "Retry from last known good" button in the
// Operations · Incident Panel.
//
// Behavior:
//   - Only EXECUTED_FAILED / TIMED_OUT can be retried.
//   - The new ExecutionRequest carries:
//       * fresh idempotencyKey + executionId (cuid)
//       * cloned actionType, targetId, payload from the original
//       * preserved correlationId (lineage stays intact)
//       * retryMetadata: { retryOf, retriedAt, retriedBy }
//   - Created in PENDING, ENQUEUED, and only then transitioned to
//     QUEUED via the lifecycle service. That transition emits the
//     canonical audit log + SSE broadcast so the new row shows up
//     in the Live Monitor in real time.
//
// ── B5-01P′ — QUEUED IS EVIDENCE, NOT A LABEL ───────────────
//
// This endpoint used to create the clone, transition it to QUEUED,
// log "Retry queued" and return 201 — WITHOUT ever calling
// enqueueExecution. The header here said so out loud ("running it …
// is a separate concern"), while the route guard eleven lines below
// said the opposite ("Retry re-queues a real Meta mutation"). Only
// one of those could be true, and the state machine took the side
// that lies: the row sat QUEUED forever, the Live Monitor showed a
// QUEUED pill, no BullMQ job existed, and no worker ever ran. The
// operator was told work was underway that nothing would ever do.
//
// The route now calls enqueueExecution, and a failure to create the
// job WITHDRAWS the QUEUED claim (→ CANCELLED, reason
// EXECUTION_ENQUEUE_FAILED) and answers 503. QUEUED is evidence of a
// job, not a label the row wears on its own.
//
// Enqueue-then-claim would be the tighter order and is deliberately
// NOT used: executionWorker transitions QUEUED → EXECUTING only
// `if (execution.status === QUEUED)` and then calls executeMetaAction
// unconditionally, so a job that arrives before its row is QUEUED
// reaches a real Meta mutation with no EXECUTING transition at all.
// Claiming first closes that race; step 3 undoes the claim when the
// job never appears.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';
import { enqueueExecution } from '../../queues/index.js';
import { ExecutionStatus, TransitionActor } from '@marcom/runtime-contracts';
import { requireFreshAuthority } from '../../middleware/requireFreshAuthority.js';
import { WORKSPACE_ROLE }    from '../../services/collaboration/roleScope.js';
import { loadExecutability, NOT_EXECUTABLE } from '../../services/execution/decisionEligibility.js';

/**
 * Statuses eligible for retry. Only failure terminals — retrying a
 * CANCELLED is conceptually a "re-run", and retrying a success is
 * a no-op, so both are excluded.
 */
const RETRYABLE_STATUSES = ['EXECUTED_FAILED', 'TIMED_OUT'];

/**
 * B5-01P′ — the machine-readable class for "the execution job could not be
 * created". Distinct from RETRY_TRANSITION_FAILED (the job EXISTS but the row
 * could not be advanced): a caller has to be able to tell "nothing will run"
 * from "something may already be running".
 */
export const EXECUTION_ENQUEUE_FAILED = 'EXECUTION_ENQUEUE_FAILED';

// ── R11 (I70) — bounded retry chains ─────────────────────────
// `retryMetadata.retryOf` was written on every clone and read by nothing, so a
// retry of a retry of a retry was unbounded — and each link re-queues a real
// Meta mutation. The only limiter on the path was the (IP-keyed) apiLimiter.
//
// Depth is carried on the clone rather than walked backwards through the chain:
// a recursive lookup would be N queries deep on exactly the request we are
// trying to bound, and the number we need is already known at write time.
export const MAX_RETRY_DEPTH = Number(process.env.MAX_RETRY_DEPTH || 3);

/** How many retries deep an execution already is. Absent metadata ⇒ 0. */
export function retryDepthOf(execution) {
  const depth = execution?.retryMetadata?.retryDepth;
  return Number.isInteger(depth) && depth > 0 ? depth : 0;
}

export function registerRetryRoute(router) {
  // Retry re-queues a real Meta mutation — same execution tier as POST /meta.
  router.post('/:id/retry', requireFreshAuthority(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
    const { id: originalId } = req.params;
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      const original = await prisma.executionRequest.findUnique({
        where: { id: originalId },
        select: {
          id: true,
          workspaceId: true,
          actionType: true,
          targetId: true,
          payload: true,
          status: true,
          correlationId: true,
          decisionId: true, // R10 — carried onto the clone below
          retryMetadata: true, // R11 (I70) — carries the chain depth
        },
      });

      if (!original) {
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      if (original.workspaceId !== workspaceId) {
        logger.warn({ originalId, workspaceId, executionWorkspaceId: original.workspaceId, userId },
          '[ExecutionRouter] Retry blocked by workspace mismatch');
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      if (!RETRYABLE_STATUSES.includes(original.status)) {
        return res.status(409).json({
          error: `Execution is not in a retryable state (current: ${original.status})`,
          code: 'NOT_RETRYABLE',
          retryableStatuses: RETRYABLE_STATUSES,
        });
      }

      // R11 (I70) — refuse an unbounded retry chain. Checked after the state
      // check so an operator retrying a legitimately-failed execution gets the
      // more specific answer, and expressed as a 409 because it is a conflict
      // with the chain's history, not a malformed request.
      const depth = retryDepthOf(original);
      if (depth >= MAX_RETRY_DEPTH) {
        logger.warn({ originalId, workspaceId, userId, depth, max: MAX_RETRY_DEPTH },
          '[ExecutionRouter] Retry refused — chain depth exhausted');
        return res.status(409).json({
          error: `This execution has already been retried ${depth} times. Investigate the failure before retrying again.`,
          code: 'RETRY_DEPTH_EXCEEDED',
          retryDepth: depth,
          maxRetryDepth: MAX_RETRY_DEPTH,
        });
      }

      // ── B4-A (D2) — the decision must STILL be executable ────────────────
      //
      // meta.js has carried this check since the split; this route did not, and
      // it is the other producer of ExecutionRequest rows. A retry re-enters the
      // execution path with the ORIGINAL decisionId, and the gap between the
      // first attempt and the retry is exactly when a sweep supersedes a verdict
      // or an operator dismisses it.
      //
      // The worker checks again before the real Meta call, so no platform
      // mutation was ever landing against a terminal decision. What was landing
      // is a queued row and a 202 that reads as acceptance — the operator is
      // told the retry is under way, and only the worker log says it will not
      // be. Refusing here makes the two producers agree, and it refuses at the
      // boundary rather than downstream of it.
      //
      // Only when a decision is actually named: an execution carrying no
      // decisionId is an operator acting directly on a campaign, which has no
      // decision lifecycle to violate.
      if (original.decisionId) {
        const { executable, reason } = await loadExecutability(workspaceId, original.decisionId);
        if (!executable) {
          logger.warn({ originalId, workspaceId, userId, decisionId: original.decisionId, reason },
            '[ExecutionRouter] Retry refused — decision is not executable');
          return res.status(409).json({
            error: reason === NOT_EXECUTABLE.DISMISSED
              ? 'This decision was dismissed; a dismissed decision cannot be executed'
              : reason === NOT_EXECUTABLE.SUPERSEDED
                ? 'This decision has been superseded by a newer verdict and cannot be executed'
                : 'This decision could not be confirmed as executable',
            code: 'DECISION_NOT_EXECUTABLE',
            reason,
          });
        }
      }

      // 1. Create clone in PENDING (the canonical initial state).
      const retriedAt = new Date().toISOString();
      const newRequest = await prisma.executionRequest.create({
        data: {
          workspaceId,
          idempotencyKey: crypto.randomUUID(),
          actionType: original.actionType,
          targetId: original.targetId,
          status: ExecutionStatus.PENDING,
          payload: original.payload,
          correlationId: original.correlationId,
          // R10 (I55) — attribution travels with the retry. Re-deriving it from
          // the payload would re-open the question the original request already
          // answered; carrying the resolved column forward cannot disagree with
          // it. The workspace was proven equal above, so the id stays in scope.
          decisionId: original.decisionId,
          retryMetadata: {
            retryOf: original.id,
            retriedAt,
            retriedBy: userId,
            // R11 (I70): the chain depth travels forward so the next retry can
            // bound itself in one read instead of walking the lineage.
            retryDepth: depth + 1,
          },
        },
        select: {
          id: true,
          workspaceId: true,
          version: true,
          correlationId: true,
        },
      });

      // 2. Transition PENDING → QUEUED via the lifecycle service.
      //    Audit + SSE moment: the Live Monitor will see the new row
      //    appear with a QUEUED pill in real time.
      //
      //    ORDER: this precedes the enqueue, matching POST /meta, and the
      //    reason is the worker rather than symmetry. executionWorker performs
      //    QUEUED → EXECUTING only `if (execution.status === QUEUED)` and then
      //    calls executeMetaAction UNCONDITIONALLY — so a job whose row is not
      //    yet QUEUED would reach a real Meta mutation having skipped the
      //    EXECUTING transition entirely. Enqueueing first would open exactly
      //    that race. The row is therefore made QUEUED before any job can
      //    observe it, and step 3 undoes the claim if the job never appears.
      let updated;
      try {
        updated = await lifecycleService.transition({
          executionId: newRequest.id,
          newStatus: ExecutionStatus.QUEUED,
          expectedVersion: newRequest.version,
          actor: TransitionActor.RETRY_POLICY,
          correlationId: original.correlationId,
          metadata: {
            reason: 'manual_retry',
            auditMetadata: {
              retryOf: original.id,
              retriedBy: userId,
            },
          },
        });
      } catch (transitionErr) {
        // The record exists but couldn't be promoted, and no job has been
        // created yet (step 3 has not run). Log + surface a 500 so the operator
        // sees the failure rather than a silent PENDING ghost. A PENDING row is
        // not a claim that anything is queued, so nothing here is fabricated.
        logger.error({
          originalId,
          newExecutionId: newRequest.id,
          workspaceId,
          userId,
          error: transitionErr.message,
        }, '[ExecutionRouter] Retry transition failed');
        return res.status(500).json({
          error: 'Retry created but could not be queued',
          code: 'RETRY_TRANSITION_FAILED',
          executionId: newRequest.id,
        });
      }

      // 3. Create the execution job. Until this succeeds the QUEUED above is a
      //    claim, not a fact — this is what turns it into one.
      //    jobId = executionId, so a duplicate enqueue of the same clone is a
      //    BullMQ no-op rather than a second Meta mutation.
      try {
        await enqueueExecution({
          executionId: newRequest.id,
          workspaceId,
          userId,
          actionType: original.actionType,
          targetId:   original.targetId,
          // Shape-parity with POST /meta. Not authoritative: the worker reads
          // `execution.payload.options` off the row (R11 · I67), and the clone
          // carries the original payload forward, so the persisted options are
          // the ones that actually get validated and executed.
          options:    original.payload?.options ?? {},
        });
      } catch (enqueueErr) {
        // FAIL CLOSED. No job exists, so nothing will ever run this clone, and
        // it must not be left asserting QUEUED — that assertion is the whole
        // defect this slice removes. Withdraw the claim before answering.
        //
        // CANCELLED, deliberately, and NOT EXECUTED_FAILED: the transition
        // matrix admits no QUEUED → EXECUTED_FAILED edge, and inventing one
        // would make the row claim a provider attempt that never happened —
        // the same species of lie as the QUEUED it replaces. CANCELLED states
        // what is true: this execution never started. The code below carries WHY.
        let closed = true;
        try {
          await lifecycleService.transition({
            executionId:     newRequest.id,
            newStatus:       ExecutionStatus.CANCELLED,
            expectedVersion: updated.version,
            actor:           TransitionActor.SYSTEM,
            correlationId:   original.correlationId,
            metadata: {
              reason: EXECUTION_ENQUEUE_FAILED,
              auditMetadata: { retryOf: original.id, retriedBy: userId, enqueueError: enqueueErr.message },
            },
          });
        } catch (closeErr) {
          // Logged and surfaced, never swallowed into a success. The response
          // is still a failure either way; `stranded` tells an operator that a
          // row is left claiming QUEUED with no job behind it, which is the one
          // state this endpoint can no longer fix by itself.
          closed = false;
          logger.error({
            newExecutionId: newRequest.id, workspaceId, error: closeErr.message,
          }, '[ExecutionRouter] Retry enqueue failed AND the QUEUED claim could not be withdrawn');
        }

        logger.error({
          originalId, newExecutionId: newRequest.id, workspaceId, userId,
          error: enqueueErr.message, closed,
        }, '[ExecutionRouter] Retry enqueue failed — nothing will run');

        return res.status(503).json({
          error: 'Retry could not be queued for execution — no work has been started',
          code:  EXECUTION_ENQUEUE_FAILED,
          executionId: newRequest.id,
          stranded: !closed,
        });
      }

      logger.info({
        originalId,
        newExecutionId: newRequest.id,
        workspaceId,
        userId,
        correlationId: original.correlationId,
      }, '[ExecutionRouter] Retry queued');

      return res.status(201).json({
        executionId: newRequest.id,
        status: ExecutionStatus.QUEUED,
        retryOf: original.id,
        correlationId: original.correlationId,
        version: updated.version,
      });
    } catch (err) {
      logger.error({
        originalId,
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      }, '[ExecutionRouter] Retry failed');
      return res.status(500).json({
        error: 'Failed to retry execution',
        code: 'RETRY_ERROR',
      });
    }
  });
}
