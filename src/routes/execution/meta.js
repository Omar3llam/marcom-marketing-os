// ============================================================
// POST /api/execute/meta — Execute a Meta Ads action
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
import { prisma } from '../../lib/prisma.js';
import { executeMetaAction } from '../../services/metaExecutionService.js';
import { logger } from '../../utils/logger.js';
import { broadcastWorkspaceEvent } from '../events.js';

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

/**
 * Layer 1: Validate request format and action type.
 * Returns error string if invalid, null if valid.
 */
function validateRequest(actionType, targetId, targetType, idempotencyKey) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return 'idempotencyKey is required and must be a non-empty string (use crypto.randomUUID() on client)';
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
}
