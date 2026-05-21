// ============================================================
// Execution Lifecycle Service
// Phase 11B Task 3: Central transition authority
//
// ARCHITECTURAL LAW 1: Single Transition Authority
// After Task 3, ALL status transitions MUST go through this service.
// Any direct prisma.executionRequest.update() = architectural violation.
//
// ARCHITECTURAL LAW 2: Transition Validation Before OCC Write
// Order: READ → validate → OCC → emit (never reversed)
//
// ARCHITECTURAL LAW 3: Lifecycle Service Must Be Stateless
// No in-memory execution state. All state authority = database.
//
// ARCHITECTURAL LAW 5: Timeouts Are State Transitions
// EXECUTING → TIMED_OUT goes through: validation, OCC, audit, telemetry
// ============================================================

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import {
  updateWithOCC,
  isConcurrencyError,
} from '../../utils/occHelpers.js';
import {
  ExecutionStatus,
  isTerminalState,
  TransitionActor,
  getTimeoutForStatus,
  isExecutionTimedOut,
} from '@marcom/runtime-contracts';
import {
  validateTransition,
  validateTransitionRequest,
  validateTimeoutTransition,
  validateCancellation,
} from './transitionValidators.js';
import {
  createTransitionEvent,
  emitTransitionEvent,
  createConcurrencyViolationEvent,
  emitConcurrencyViolationEvent,
  createTimeoutEvent,
  emitTimeoutEvent,
} from './lifecycleTelemetry.js';
import { broadcastWorkspaceEvent } from '../../lib/sseRegistry.js';

/**
 * Execution Lifecycle Service
 *
 * Central authority for ALL execution state transitions.
 * Enforces governance constraints, OCC, audit, telemetry.
 *
 * IMPORTANT: This service is completely stateless.
 * Database is the single source of truth.
 */
export class ExecutionLifecycleService {
  /**
   * Transition Execution to New State
   *
   * The ONLY method that should mutate execution status.
   * All routes, workers, orchestrators MUST call this method.
   *
   * Sequence (Architectural Law 2):
   * 1. READ CURRENT STATE from database
   * 2. Validate transition matrix
   * 3. Validate terminal immutability
   * 4. Validate timeout policy
   * 5. OCC write with version increment
   * 6. Emit telemetry/event
   *
   * @param {object} request - Transition request
   * @param {string} request.executionId - Execution request ID
   * @param {string} request.newStatus - Desired next status
   * @param {number} request.expectedVersion - Version expected (OCC lock)
   * @param {string} request.actor - Who initiated (TransitionActor)
   * @param {string} request.correlationId - Correlation lineage ID
   * @param {object} request.metadata - Additional context (response, error, etc.)
   * @returns {Promise<object>} Updated ExecutionRequest
   * @throws {IllegalTransitionError} If transition is invalid
   * @throws {ConcurrencyError} If version mismatch detected
   */
  async transition(request) {
    // Step 0: Validate request payload
    const requestValidation = validateTransitionRequest(request);
    if (!requestValidation.valid) {
      throw requestValidation.error;
    }

    const {
      executionId,
      newStatus,
      expectedVersion,
      actor,
      correlationId,
      metadata = {},
    } = request;

    logger.debug({
      executionId,
      newStatus,
      expectedVersion,
      actor,
      correlationId,
    }, 'ExecutionLifecycleService.transition() called');

    // Step 1: READ CURRENT STATE from database
    // (Architectural Law 3: Database is authority, not memory)
    const currentExecution = await prisma.executionRequest.findUnique({
      where: { id: executionId },
    });

    if (!currentExecution) {
      const error = new Error(`ExecutionRequest ${executionId} not found`);
      logger.error({ executionId, actor }, error.message);
      throw error;
    }

    const currentStatus = currentExecution.status;

    // Step 2: Validate transition (matrix, terminal immutability, etc.)
    const validation = validateTransition(currentExecution, newStatus, actor);
    if (!validation.valid) {
      throw validation.error;
    }

    // Step 3: Prepare update data
    const updateData = {
      status: newStatus,
      correlationId: correlationId || currentExecution.correlationId || executionId,
    };

    // Add metadata fields if provided
    if (metadata.response !== undefined) {
      updateData.response = metadata.response;
    }
    if (metadata.activeStep !== undefined) {
      updateData.activeStep = metadata.activeStep;
    }
    if (metadata.retryMetadata !== undefined) {
      updateData.retryMetadata = metadata.retryMetadata;
    }

    // Step 4: OCC write with version increment
    let updatedExecution;
    try {
      updatedExecution = await updateWithOCC(
        executionId,
        expectedVersion,
        updateData
      );
    } catch (error) {
      // Handle OCC concurrency violation
      if (isConcurrencyError(error)) {
        const violationEvent = createConcurrencyViolationEvent({
          executionId,
          expectedVersion,
          actualVersion: error.actualVersion,
          correlationId: updateData.correlationId,
          actor,
        });
        emitConcurrencyViolationEvent(violationEvent);
      }

      // Re-throw error for caller to handle
      throw error;
    }

    // Step 5: Persist transition to audit log
    // (Task 7 Architectural Law: Every state mutation must emit a durable transition record)
    await this._createTransitionAuditLog({
      executionId,
      workspaceId: currentExecution.workspaceId,
      fromStatus: currentStatus,
      toStatus: newStatus,
      actor,
      correlationId: updateData.correlationId,
      reason: metadata.reason || null,
      previousVersion: expectedVersion,
      newVersion: updatedExecution.version,
      metadata: metadata.auditMetadata || null,
    });

    // Step 6: Emit transition event (telemetry + observability)
    // (Architectural Law 4: Transition events are first-class citizens)
    const transitionEvent = createTransitionEvent({
      executionId,
      fromStatus: currentStatus,
      toStatus: newStatus,
      fromVersion: expectedVersion,
      toVersion: updatedExecution.version,
      correlationId: updateData.correlationId,
      actor,
      metadata,
    });
    emitTransitionEvent(transitionEvent);

    // Step 7: SSE broadcast to workspace subscribers (Phase 11C Task 2)
    // Best-effort: a broadcast failure must NOT fail the transition.
    // SSE = transport optimization; reconciliation is the authority.
    try {
      broadcastWorkspaceEvent(currentExecution.workspaceId, {
        type: 'execution.transition',
        ...transitionEvent,
        // Carry the canonical action + target so subscribers can update
        // the Live Monitor row without an extra fetch.
        execution: {
          id: executionId,
          actionType: currentExecution.actionType,
          targetId: currentExecution.targetId,
          status: newStatus,
          version: updatedExecution.version,
          correlationId: updateData.correlationId,
          updatedAt: updatedExecution.updatedAt,
        },
      });
    } catch (err) {
      logger.warn({
        executionId,
        workspaceId: currentExecution.workspaceId,
        error: err.message,
      }, 'SSE broadcast failed (non-fatal)');
    }

    logger.info({
      executionId,
      transition: `${currentStatus} → ${newStatus}`,
      version: updatedExecution.version,
      actor,
      correlationId: updateData.correlationId,
      isTerminal: isTerminalState(newStatus),
    }, 'Execution transition successful');

    return updatedExecution;
  }

  /**
   * Timeout Execution
   *
   * Automatic timeout transition for zombie executions.
   * This is a specialized transition that:
   * 1. Validates execution is timeout-eligible
   * 2. Transitions to TIMED_OUT status
   * 3. Emits timeout event for monitoring
   *
   * ARCHITECTURAL LAW 5: Timeouts Are State Transitions
   * This method goes through the FULL transition pipeline:
   * validation → OCC → audit → telemetry
   *
   * @param {string} executionId - Execution request ID
   * @param {string} correlationId - Correlation lineage ID
   * @returns {Promise<object>} Updated ExecutionRequest
   * @throws {Error} If execution not found or already terminal
   */
  async timeout(executionId, correlationId) {
    logger.debug({ executionId, correlationId }, 'Timeout check initiated');

    // Step 1: Fetch current execution state
    const execution = await prisma.executionRequest.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`ExecutionRequest ${executionId} not found`);
    }

    // Step 2: Validate timeout is applicable
    const validation = validateTimeoutTransition(execution);
    if (!validation.valid) {
      throw validation.error;
    }

    // Step 3: Check if actually timed out
    if (!isExecutionTimedOut(execution)) {
      logger.debug({
        executionId,
        status: execution.status,
        updatedAt: execution.updatedAt,
      }, 'Execution not yet timed out');
      return execution;
    }

    // Step 4: Calculate elapsed time for telemetry
    const elapsed = Date.now() - new Date(execution.updatedAt);
    const timeout = getTimeoutForStatus(execution.status);

    // Step 5: Emit timeout event
    const timeoutEvent = createTimeoutEvent({
      executionId,
      fromStatus: execution.status,
      elapsed,
      timeout,
      correlationId: correlationId || execution.correlationId || executionId,
    });
    emitTimeoutEvent(timeoutEvent);

    // Step 6: Transition to TIMED_OUT through standard pipeline
    return this.transition({
      executionId,
      newStatus: ExecutionStatus.TIMED_OUT,
      expectedVersion: execution.version,
      actor: TransitionActor.TIMEOUT_HANDLER,
      correlationId: correlationId || execution.correlationId || executionId,
      metadata: {
        elapsed,
        timeout,
        overage: elapsed - timeout,
      },
    });
  }

  /**
   * Cancel Execution
   *
   * User-initiated cancellation.
   * Only allowed from non-terminal states.
   *
   * @param {string} executionId - Execution request ID
   * @param {string} userId - User who requested cancellation
   * @param {string} correlationId - Correlation lineage ID
   * @returns {Promise<object>} Updated ExecutionRequest
   * @throws {Error} If execution not found or already terminal
   */
  async cancel(executionId, userId, correlationId) {
    logger.debug({ executionId, userId, correlationId }, 'Cancellation requested');

    // Step 1: Fetch current execution state
    const execution = await prisma.executionRequest.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`ExecutionRequest ${executionId} not found`);
    }

    // Step 2: Validate cancellation is allowed
    const validation = validateCancellation(execution);
    if (!validation.valid) {
      throw validation.error;
    }

    // Step 3: Transition to CANCELLED through standard pipeline
    return this.transition({
      executionId,
      newStatus: ExecutionStatus.CANCELLED,
      expectedVersion: execution.version,
      actor: TransitionActor.USER,
      correlationId: correlationId || execution.correlationId || executionId,
      metadata: {
        userId,
        reason: 'user_cancelled',
      },
    });
  }

  /**
   * Get Current Execution State
   *
   * Fetches execution with reconciliation payload format.
   * Used by GET /api/execution/:id/active endpoint.
   *
   * This endpoint provides authoritative state for client recovery after:
   * - SSE disconnect
   * - Browser refresh
   * - Tab crash
   * - Worker restart
   * - Race conflict
   * - Timeout transition
   *
   * IMPORTANT: This is read-only authority. No side effects, no mutations.
   * sessionStorage is transient optimization cache only.
   * This endpoint is the single source of truth.
   *
   * @param {string} executionId - Execution request ID
   * @returns {Promise<object>} ExecutionReconciliationPayload
   */
  async getExecutionState(executionId) {
    const execution = await prisma.executionRequest.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`ExecutionRequest ${executionId} not found`);
    }

    const now = new Date();
    const terminal = isTerminalState(execution.status);

    // Calculate stale detection metadata
    const lastTransitionAt = execution.updatedAt;
    const elapsedSinceTransition = now - new Date(lastTransitionAt);
    const timeout = getTimeoutForStatus(execution.status);

    // Execution is stale if:
    // 1. Non-terminal AND exceeded timeout threshold
    // 2. Terminal states are never stale (immutable)
    const isStale = !terminal && timeout !== null && elapsedSinceTransition > timeout;

    // canResume: true if non-terminal and not stale
    // Clients can resume polling/SSE for non-terminal, fresh executions
    const canResume = !terminal && !isStale;

    // Format as reconciliation payload (Architecture Gate Decision 1)
    const payload = {
      // Identity
      executionId: execution.id,
      correlationId: execution.correlationId || execution.id,

      // State
      status: execution.status,
      version: execution.version,
      isTerminal: terminal,

      // Timestamps
      updatedAt: execution.updatedAt.toISOString(),
      lastTransitionAt: lastTransitionAt.toISOString(),
      serverNow: now.toISOString(),

      // Resumability
      canResume,
      isStale,

      // Step tracking
      activeStep: execution.activeStep || null,

      // Retry metadata
      retryMetadata: execution.retryMetadata || null,
    };

    // For terminal states: include final response/error
    // This prevents "infinite spinner syndrome" 🌀
    if (terminal && execution.response) {
      payload.response = execution.response;
    }

    return payload;
  }

  /**
   * Create Transition Audit Log
   *
   * Persists immutable transition record to ExecutionTransition table.
   * This is the "black box recorder" for forensic debugging.
   *
   * ARCHITECTURAL LAW (Task 7):
   * Every state mutation must emit a durable transition record.
   *
   * @private
   * @param {object} params - Transition parameters
   * @param {string} params.executionId - Execution request ID
   * @param {string} params.workspaceId - Workspace ID
   * @param {string} params.fromStatus - Previous status
   * @param {string} params.toStatus - New status
   * @param {string} params.actor - TransitionActor value
   * @param {string} params.correlationId - Correlation lineage ID
   * @param {string|null} params.reason - Optional transition reason
   * @param {number} params.previousVersion - Previous version
   * @param {number} params.newVersion - New version
   * @param {object|null} params.metadata - Optional metadata
   * @returns {Promise<object>} Created ExecutionTransition record
   */
  async _createTransitionAuditLog({
    executionId,
    workspaceId,
    fromStatus,
    toStatus,
    actor,
    correlationId,
    reason,
    previousVersion,
    newVersion,
    metadata,
  }) {
    try {
      const transition = await prisma.executionTransition.create({
        data: {
          executionId,
          workspaceId,
          fromStatus,
          toStatus,
          actor,
          correlationId,
          reason,
          previousVersion,
          newVersion,
          metadata,
        },
      });

      logger.debug({
        transitionId: transition.id,
        executionId,
        transition: `${fromStatus} → ${toStatus}`,
        actor,
        version: `${previousVersion} → ${newVersion}`,
      }, 'Transition audit log created');

      return transition;
    } catch (error) {
      // Log error but don't fail the transition
      // Audit log creation failure should not block execution flow
      logger.error({
        executionId,
        fromStatus,
        toStatus,
        actor,
        error: error.message,
      }, 'Failed to create transition audit log');

      // Don't throw - audit log is best-effort
      // The transition already succeeded (OCC write)
      return null;
    }
  }

  /**
   * Health Check
   *
   * Verifies ExecutionLifecycleService is operational.
   * Used by infrastructure monitoring.
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      // Verify database connectivity
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: 'healthy',
        service: 'ExecutionLifecycleService',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error: error.message }, 'ExecutionLifecycleService health check failed');

      return {
        status: 'unhealthy',
        service: 'ExecutionLifecycleService',
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}

// Export singleton instance
export const lifecycleService = new ExecutionLifecycleService();

// Export class for testing
export default ExecutionLifecycleService;
