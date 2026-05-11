// ============================================================
// MARCOM / Lumi — Meta Execution Router
// ============================================================
// STRICT ENTERPRISE GUARDRAILS:
//   Layer 1: VALIDATION (allowed actions, target types)
//   Layer 2: IDEMPOTENCY (prevent duplicates via unique keys)
//   Layer 3: EXECUTION (call Meta API via service)
//   Layer 4: AUDIT LOGGING (log all outcomes)
//
// Every action is:
// - Multi-tenant scoped (workspaceId from auth context)
// - Validated before execution
// - Logged before returning to client
// - Idempotent (same key = replay stored response, no re-execution)
// ============================================================
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { executeMetaAction, validateActionTarget } from '../services/metaExecutionService.js';
import { firebaseAuthMiddleware } from '../middleware/firebaseAuth.js';
import { contextGuard } from '../middleware/contextGuard.js';
import { logger } from '../utils/logger.js';
import { broadcastWorkspaceEvent } from './events.js';
const router = Router();

// ── Constants ────────────────────────────────────────────

/** Map of allowed action types to valid target types */
const ALLOWED_ACTIONS = {
  PAUSE_CAMPAIGN: ['campaign'],
  RESUME_CAMPAIGN: ['campaign'],
  SCALE_CAMPAIGN: ['campaign'],
  OPTIMIZE_CAMPAIGN: ['campaign'],
  INCREASE_BUDGET: ['campaign', 'adset'],
  DECREASE_BUDGET: ['campaign', 'adset'],
  PAUSE_ADSET: ['adset'],
  RESUME_ADSET: ['adset'],
};

/** Idempotency: deduplicate based on unique keys, not time windows */

// ── Middleware ───────────────────────────────────────────

router.use(firebaseAuthMiddleware);
router.use(contextGuard);

// ── POST /api/execute/meta ───────────────────────────────

/**
 * Execute a Meta Ads action with strict enterprise guardrails.
 *
 * Request body:
 * {
 *   "actionType": "PAUSE_CAMPAIGN" | "INCREASE_BUDGET" | etc.,
 *   "targetId": "123456789",
 *   "targetType": "campaign" | "adset",
 *   "idempotencyKey": "uuid",  // Required for deduplication
 *   "options": { "amount": 5000 }  // Optional, action-dependent
 * }
 *
 * Response:
 * {
 *   "success": true|false,
 *   "idempotentReplay": boolean,  // true if replayed from cache
 *   "executionId": "uuid",
 *   "auditLogId": "uuid",
 *   "status": "EXECUTED_SUCCESS" | "EXECUTED_FAILED",
 *   "data": { ... },  // Meta API response
 *   "error": "..."    // If failed
 * }
 */
router.post('/meta', async (req, res) => {
  const { actionType, targetId, targetType, idempotencyKey, options } = req.body;
  const { userId, workspaceId } = req.user;

  try {
    // ═══════════════════════════════════════════════════════
    // LAYER 1: VALIDATION
    // ═══════════════════════════════════════════════════════
    const validationError = validateRequest(actionType, targetId, targetType, idempotencyKey);
    if (validationError) {
      logger.warn(`[ExecutionRouter] Validation failed`, {
        workspaceId,
        userId,
        actionType,
        targetId,
        reason: validationError,
      });

      // Create audit log for failed validation
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          actionType: actionType,
          targetId,
          platform: 'META',
          status: 'FAILED',
          errorMessage: validationError,
          payload: req.body,
        },
      });

      return res.status(400).json({
        success: false,
        error: validationError,
        code: 'VALIDATION_ERROR',
      });
    }

    // ═══════════════════════════════════════════════════════
    // LAYER 2: IDEMPOTENCY CHECK
    // ═══════════════════════════════════════════════════════
    const existingRequest = await prisma.executionRequest.findUnique({
      where: { idempotencyKey },
    });

    if (existingRequest) {
      // Idempotent replay: return previous response
      logger.info(`[ExecutionRouter] Idempotent replay`, {
        workspaceId,
        userId,
        actionType,
        targetId,
        idempotencyKey,
        executionId: existingRequest.id,
        status: existingRequest.status,
      });

      return res.status(200).json({
        success: existingRequest.status === 'EXECUTED_SUCCESS',
        idempotentReplay: true,
        executionId: existingRequest.id,
        status: existingRequest.status,
        ...(existingRequest.response && { data: existingRequest.response }),
        ...(existingRequest.status === 'FAILED' && existingRequest.response?.error && {
          error: existingRequest.response.error,
        }),
      });
    }

    // Create ExecutionRequest BEFORE execution
    const executionRequest = await prisma.executionRequest.create({
      data: {
        workspaceId,
        idempotencyKey,
        actionType,
        targetId,
        status: 'PENDING',
        payload: req.body,
      },
    });

    logger.info(`[ExecutionRouter] Created ExecutionRequest`, {
      executionId: executionRequest.id,
      idempotencyKey,
      workspaceId,
    });

    // ═══════════════════════════════════════════════════════
    // LAYER 3: EXECUTION (call Meta API)
    // ═══════════════════════════════════════════════════════

    // Broadcast: QUEUED
    broadcastWorkspaceEvent(workspaceId, {
      type: 'EXECUTION_STATUS',
      status: 'QUEUED',
      targetId,
      actionType,
      timestamp: new Date().toISOString(),
    });

    logger.info(`[ExecutionRouter] Starting execution`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      targetType,
    });

    // Broadcast: EXECUTING
    broadcastWorkspaceEvent(workspaceId, {
      type: 'EXECUTION_STATUS',
      status: 'EXECUTING',
      targetId,
      actionType,
      timestamp: new Date().toISOString(),
    });

    const executionResult = await executeMetaAction(
      workspaceId,
      userId,
      actionType,
      targetId,
      options
    );

    // ═══════════════════════════════════════════════════════
    // LAYER 4: AUDIT LOGGING (always log the outcome)
    // ═══════════════════════════════════════════════════════
    const auditLog = await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        actionType: actionType,
        targetId,
        platform: 'META',
        status: executionResult.success ? 'SUCCESS' : 'FAILED',
        payload: req.body,
        response: executionResult.success ? executionResult.data : null,
        errorMessage: executionResult.success ? null : executionResult.error,
      },
    });

    logger.info(`[ExecutionRouter] Execution completed`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      success: executionResult.success,
      auditLogId: auditLog.id,
    });

    // ─────────────────────────────────────────────────────
    // Broadcast: SUCCESS or FAILED
    // ─────────────────────────────────────────────────────
    if (executionResult.success) {
      broadcastWorkspaceEvent(workspaceId, {
        type: 'EXECUTION_STATUS',
        status: 'EXECUTED_SUCCESS',
        targetId,
        actionType,
        auditLogId: auditLog.id,
        timestamp: new Date().toISOString(),
      });
    } else {
      broadcastWorkspaceEvent(workspaceId, {
        type: 'EXECUTION_STATUS',
        status: 'EXECUTED_FAILED',
        targetId,
        actionType,
        auditLogId: auditLog.id,
        error: executionResult.error,
        timestamp: new Date().toISOString(),
      });
    }

    // ─────────────────────────────────────────────────────
    // Update ExecutionRequest with result
    // ─────────────────────────────────────────────────────
    const finalStatus = executionResult.success ? 'EXECUTED_SUCCESS' : 'FAILED';
    await prisma.executionRequest.update({
      where: { id: executionRequest.id },
      data: {
        status: finalStatus,
        response: executionResult.success
          ? executionResult.data
          : { error: executionResult.error, code: executionResult.code },
      },
    });

    // ─────────────────────────────────────────────────────
    // Return response to client
    // ─────────────────────────────────────────────────────
    if (executionResult.success) {
      return res.status(200).json({
        success: true,
        idempotentReplay: false,
        executionId: executionRequest.id,
        auditLogId: auditLog.id,
        status: finalStatus,
        data: executionResult.data,
        message: `${actionType} executed successfully on Meta`,
      });
    } else {
      return res.status(400).json({
        success: false,
        idempotentReplay: false,
        executionId: executionRequest.id,
        auditLogId: auditLog.id,
        status: finalStatus,
        error: executionResult.error,
        code: executionResult.code,
        message: `${actionType} failed: ${executionResult.error}`,
      });
    }
  } catch (err) {
    logger.error(`[ExecutionRouter] Unhandled error`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      error: err.message,
      stack: err.stack,
    });

    // Attempt to log the error to audit log
    try {
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          actionType: actionType,
          targetId,
          platform: 'META',
          status: 'FAILED',
          errorMessage: err.message,
          payload: req.body,
        },
      });
    } catch (logErr) {
      logger.error('[ExecutionRouter] Failed to create audit log', { error: logErr.message });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error during execution',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ── GET /api/execute/audit ──────────────────────────────

/**
 * Retrieve execution audit trail for a workspace.
 * Query params:
 *   - limit: default 50
 *   - offset: default 0
 *   - status: 'SUCCESS' | 'FAILED' | 'PENDING'
 *   - actionType: filter by action type
 */
router.get('/audit', async (req, res) => {
  const { workspaceId, userId } = req.user;
  const { limit = 50, offset = 0, status, actionType } = req.query;

  try {
    const where = {
      workspaceId,
      ...(status && { status }),
      ...(actionType && { actionType }),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { performedAt: 'desc' },
      skip: parseInt(String(offset), 10),
      take: parseInt(String(limit), 10),
    });

    const total = await prisma.auditLog.count({ where });

    logger.info(`[ExecutionRouter] Audit query`, {
      workspaceId,
      userId,
      count: logs.length,
      total,
    });

    return res.json({
      logs,
      total,
      limit: parseInt(String(limit), 10),
      offset: parseInt(String(offset), 10),
    });
  } catch (err) {
    logger.error('[ExecutionRouter] Audit query failed', {
      workspaceId,
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to retrieve audit logs',
      code: 'AUDIT_QUERY_ERROR',
    });
  }
});

// ── Validation Helper ────────────────────────────────────

/**
 * Layer 1: Validate request format and action type.
 * Returns error string if invalid, null if valid.
 */
function validateRequest(actionType, targetId, targetType, idempotencyKey) {
  // Ensure idempotency key is provided
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return 'idempotencyKey is required and must be a non-empty string (use crypto.randomUUID() on client)';
  }

  // Ensure action type is in allowed list
  if (!actionType || !ALLOWED_ACTIONS[actionType]) {
    return `Invalid action type: ${actionType}. Must be one of: ${Object.keys(ALLOWED_ACTIONS).join(', ')}`;
  }

  // Ensure target ID is provided and non-empty
  if (!targetId || typeof targetId !== 'string' || targetId.trim().length === 0) {
    return 'targetId is required and must be a non-empty string';
  }

  // Ensure target type matches action
  if (!targetType || !ALLOWED_ACTIONS[actionType].includes(targetType.toLowerCase())) {
    return `Invalid target type "${targetType}" for action "${actionType}". Must be one of: ${ALLOWED_ACTIONS[actionType].join(', ')}`;
  }

  return null;
}

export default router;
