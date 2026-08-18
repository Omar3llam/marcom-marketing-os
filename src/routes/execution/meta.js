// ============================================================
// POST /api/execute/meta — Execute a Meta Ads action
// ============================================================
// FOUR-LAYER GUARD PATTERN (PR #18: async execution):
//
//   Layer 1: VALIDATION    — allowed actions, target types
//   Layer 2: IDEMPOTENCY   — prevent duplicates via unique key
//   Layer 3: QUEUEING      — backpressure check → PENDING→QUEUED
//                            transition → enqueue → 202 Accepted
//   Layer 4: AUDIT LOG     — record every queued action attempt
//
// The Meta API call happens asynchronously in executionWorker.js.
// Workers broadcast SSE events via lifecycleService.transition().
//
// Invariants enforced here:
//   VI-4 — backpressure before queueing (MAX_QUEUE_DEPTH)
//   I-2  — correlationId set at creation time
//   II-3 — PENDING → QUEUED via lifecycleService (no direct update)
// ============================================================
import { prisma }          from '../../lib/prisma.js';
import { logger }          from '../../utils/logger.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';
import { executionQueue, enqueueExecution } from '../../queues/index.js';
import { ExecutionStatus, TransitionActor } from '@marcom/runtime-contracts';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE }    from '../../services/collaboration/roleScope.js';
import { resolveAttribution } from '../../services/execution/decisionAttribution.js';

const MAX_QUEUE_DEPTH = Number(process.env.MAX_QUEUE_DEPTH || 500);

/** Map of allowed action types to valid target types */
const ALLOWED_ACTIONS = {
  PAUSE_CAMPAIGN:    ['campaign'],
  RESUME_CAMPAIGN:   ['campaign'],
  SCALE_CAMPAIGN:    ['campaign'],
  OPTIMIZE_CAMPAIGN: ['campaign'],
  INCREASE_BUDGET:   ['campaign', 'adset'],
  DECREASE_BUDGET:   ['campaign', 'adset'],
  PAUSE_ADSET:       ['adset'],
  RESUME_ADSET:      ['adset'],
  // Phase 2 — first-class verdict execution paths (human still confirms)
  REALLOCATE_BUDGET: ['campaign', 'adset'],
  REFRESH_CREATIVE:  ['adset', 'ad'],
};

/**
 * Layer 1 validation.
 * Returns an error string if invalid, null if valid.
 */
function validateRequest(actionType, targetId, targetType, idempotencyKey) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return 'idempotencyKey is required and must be a non-empty string';
  }
  if (!actionType || !ALLOWED_ACTIONS[actionType]) {
    return `Invalid action type: ${actionType}. Must be one of: ${Object.keys(ALLOWED_ACTIONS).join(', ')}`;
  }
  if (!targetId || typeof targetId !== 'string' || targetId.trim().length === 0) {
    return 'targetId is required and must be a non-empty string';
  }
  if (!targetType || !ALLOWED_ACTIONS[actionType].includes(targetType.toLowerCase())) {
    return `Invalid target type "${targetType}" for action "${actionType}". Must be one of: ${ALLOWED_ACTIONS[actionType].join(', ')}`;
  }
  return null;
}

export function registerMetaRoute(router) {
  // Executing a Meta action is a BUYER/STRATEGIST capability — a CLIENT
  // (read-only leadership) seat must never queue a real ad-platform mutation.
  router.post('/meta', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
    const { actionType, targetId, targetType, idempotencyKey, options, decisionId } = req.body;
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      // ═══════════════════════════════════════════════════════
      // LAYER 1: VALIDATION
      // ═══════════════════════════════════════════════════════
      const validationError = validateRequest(actionType, targetId, targetType, idempotencyKey);
      if (validationError) {
        logger.warn({
          workspaceId, userId, actionType, targetId, reason: validationError,
        }, '[ExecutionRouter] Validation failed');

        await prisma.auditLog.create({
          data: {
            workspaceId, userId,
            actionType, targetId,
            platform: 'META',
            status: 'FAILED',
            errorMessage: validationError,
            payload: req.body,
          },
        });

        return res.status(400).json({
          success: false,
          error:   validationError,
          code:    'VALIDATION_ERROR',
        });
      }

      // ═══════════════════════════════════════════════════════
      // LAYER 2: IDEMPOTENCY CHECK
      // ═══════════════════════════════════════════════════════
      // R11 (I65) — scoped to the caller's workspace.
      //
      // This was `findUnique({ where: { idempotencyKey } })` against a globally
      // unique, fully client-supplied column. Presenting another workspace's
      // key returned their executionId, status and raw stored Meta response;
      // pre-claiming a key a competitor was about to use made their real
      // request answer "idempotentReplay: true" for an action never queued.
      // A foreign key now simply does not match, and the request proceeds as
      // the new execution it is.
      const existingRequest = await prisma.executionRequest.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
      });

      if (existingRequest) {
        logger.info({
          workspaceId, userId, actionType, targetId,
          executionId: existingRequest.id,
          status:      existingRequest.status,
        }, '[ExecutionRouter] Idempotent replay');

        return res.status(200).json({
          success:         existingRequest.status === 'EXECUTED_SUCCESS',
          idempotentReplay: true,
          executionId:     existingRequest.id,
          status:          existingRequest.status,
          ...(existingRequest.response && { data: existingRequest.response }),
        });
      }

      // ═══════════════════════════════════════════════════════
      // LAYER 3: QUEUEING
      // ═══════════════════════════════════════════════════════

      // Guard: queue subsystem must be available. Invariant VI-1.
      if (!executionQueue) {
        logger.warn({ workspaceId, userId }, '[ExecutionRouter] Queue unavailable');
        return res.status(503).json({
          success: false,
          error:   'Execution queue unavailable. Please try again later.',
          code:    'QUEUE_UNAVAILABLE',
        });
      }

      // Guard: backpressure. Invariant VI-4.
      const queueDepth = await executionQueue.count();
      if (queueDepth >= MAX_QUEUE_DEPTH) {
        logger.warn({
          workspaceId, queueDepth, MAX_QUEUE_DEPTH,
        }, '[ExecutionRouter] Queue full — rejecting');
        return res.status(429).json({
          success:     false,
          error:       'Execution queue is full. Please try again later.',
          code:        'QUEUE_FULL',
          retryAfter:  30,
        });
      }

      // ── R10 (I55): attribution, resolved BEFORE the row is created ──
      // An execution that names a decision must name one in THIS workspace.
      // Refused rather than downgraded to unattributed: silently dropping the
      // link would produce a real Meta mutation whose originating call the Proof
      // Engine can never see, which is the precise gap R10 closes.
      //
      // A request that names no decision is not refused — acting on a campaign
      // no sweep has written a verdict for is a normal operator path.
      const attribution = await resolveAttribution(workspaceId, decisionId);
      if (attribution.rejected) {
        logger.warn({ workspaceId, userId, decisionId }, '[ExecutionRouter] unresolvable decision attribution');
        return res.status(422).json({
          success: false,
          error:   'decisionId does not name a decision in this workspace',
          code:    'ATTRIBUTION_UNRESOLVED',
        });
      }

      // Create ExecutionRequest at PENDING. Invariant I-1 (id immutable after create).
      const executionRequest = await prisma.executionRequest.create({
        data: {
          workspaceId,
          idempotencyKey,
          actionType,
          targetId,
          status:        ExecutionStatus.PENDING,
          correlationId: idempotencyKey, // Invariant I-2: set at creation
          payload:       req.body,
          decisionId:    attribution.decisionId,
        },
      });

      logger.info({
        executionId: executionRequest.id, idempotencyKey, workspaceId,
      }, '[ExecutionRouter] ExecutionRequest created');

      // Transition PENDING → QUEUED via lifecycle service.
      // Invariant II-3: all state changes go through lifecycleService.
      await lifecycleService.transition({
        executionId:     executionRequest.id,
        newStatus:       ExecutionStatus.QUEUED,
        expectedVersion: executionRequest.version,
        actor:           TransitionActor.API,
        correlationId:   executionRequest.correlationId,
        metadata:        { userId, workspaceId },
      });

      // Enqueue. jobId = executionId for BullMQ-level deduplication.
      await enqueueExecution({
        executionId: executionRequest.id,
        workspaceId,
        userId,
        actionType,
        targetId,
        options: options ?? {},
      });

      logger.info({
        executionId: executionRequest.id, actionType, targetId, workspaceId,
      }, '[ExecutionRouter] Execution queued');

      // ═══════════════════════════════════════════════════════
      // LAYER 4: AUDIT LOG
      // ═══════════════════════════════════════════════════════
      await prisma.auditLog.create({
        data: {
          workspaceId, userId,
          actionType, targetId,
          platform: 'META',
          status:   'QUEUED',
          payload:  req.body,
        },
      }).catch((err) => {
        // Audit log failure must not fail the execution. Log and continue.
        logger.error({
          executionId: executionRequest.id, err: err.message,
        }, '[ExecutionRouter] Audit log write failed');
      });

      // 202 Accepted: the execution is queued, not yet complete.
      return res.status(202).json({
        success:          true,
        idempotentReplay: false,
        executionId:      executionRequest.id,
        status:           ExecutionStatus.QUEUED,
        message:          `${actionType} queued for execution`,
      });

    } catch (err) {
      logger.error({
        workspaceId, userId, actionType, targetId,
        error: err.message, stack: err.stack,
      }, '[ExecutionRouter] Unhandled error');

      await prisma.auditLog.create({
        data: {
          workspaceId, userId,
          actionType, targetId,
          platform: 'META',
          status: 'FAILED',
          errorMessage: err.message,
          payload: req.body,
        },
      }).catch((auditErr) => {
        logger.warn(
          { err: auditErr.message, workspaceId, actionType },
          '[ExecutionRouter] audit log write failed in error handler'
        );
      });

      return res.status(500).json({
        success: false,
        error:   'Internal server error during execution',
        code:    'INTERNAL_ERROR',
      });
    }
  });
}
