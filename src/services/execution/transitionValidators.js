// ============================================================
// Execution Transition Validators
// Phase 11B Task 3: Validation logic for ExecutionLifecycleService
//
// Enforcement of Governance Constraints A & B:
// - Explicit state transition matrix validation
// - Terminal state immutability enforcement
// ============================================================

import {
  ExecutionStatus,
  isLegalTransition,
  isTerminalState,
  IllegalTransitionError,
} from '../../types/execution.js';
import { logger } from '../../utils/logger.js';

/**
 * Validate Transition Request
 *
 * Enforces all governance rules before allowing state transition:
 * 1. Transition must be in STATE_TRANSITION_MATRIX
 * 2. Terminal states cannot be mutated
 * 3. Status values must be valid ExecutionStatus constants
 *
 * This is the "gatekeeper" function called by ExecutionLifecycleService
 * BEFORE any OCC write occurs.
 *
 * @param {object} currentExecution - Current ExecutionRequest state
 * @param {string} newStatus - Desired next status
 * @param {string} actor - Who initiated transition (TransitionActor)
 * @returns {object} Validation result { valid: boolean, error?: Error }
 */
export function validateTransition(currentExecution, newStatus, actor) {
  const { id: executionId, status: currentStatus } = currentExecution;

  // Validation 1: Check both statuses are valid ExecutionStatus values
  if (!Object.values(ExecutionStatus).includes(currentStatus)) {
    const error = new Error(
      `Invalid current status: ${currentStatus} (execution: ${executionId})`
    );
    logger.error({
      executionId,
      currentStatus,
      newStatus,
      actor,
      error: error.message,
    }, 'Transition validation failed: invalid current status');

    return { valid: false, error };
  }

  if (!Object.values(ExecutionStatus).includes(newStatus)) {
    const error = new Error(
      `Invalid target status: ${newStatus} (execution: ${executionId})`
    );
    logger.error({
      executionId,
      currentStatus,
      newStatus,
      actor,
      error: error.message,
    }, 'Transition validation failed: invalid target status');

    return { valid: false, error };
  }

  // Validation 2: Terminal state immutability (Governance Constraint B)
  // "Once COMPLETED, FAILED, CANCELLED: no retries, no reopen, no mutation
  // except audit append. Treat terminal states like cooled lava. 🌋"
  if (isTerminalState(currentStatus)) {
    const error = new Error(
      `Cannot transition from terminal state ${currentStatus} ` +
      `(execution: ${executionId}). Terminal states are immutable.`
    );
    logger.error({
      executionId,
      currentStatus,
      newStatus,
      actor,
      error: error.message,
    }, 'Transition validation failed: terminal state immutability violation');

    return { valid: false, error };
  }

  // Validation 3: Legal transition check (Governance Constraint A)
  // "No implicit transitions. Reject everything else at service boundary.
  // No 'best effort' transitions. No auto-healing magic."
  if (!isLegalTransition(currentStatus, newStatus)) {
    const error = new IllegalTransitionError(
      currentStatus,
      newStatus,
      executionId
    );
    logger.error({
      executionId,
      currentStatus,
      newStatus,
      actor,
      error: error.message,
    }, 'Transition validation failed: illegal transition');

    return { valid: false, error };
  }

  // All validations passed
  logger.debug({
    executionId,
    currentStatus,
    newStatus,
    actor,
  }, 'Transition validation passed');

  return { valid: true };
}

/**
 * Validate Transition Request Payload
 *
 * Ensures required fields are present before attempting transition.
 * Called at ExecutionLifecycleService boundary.
 *
 * @param {object} request - Transition request object
 * @returns {object} Validation result { valid: boolean, error?: Error }
 */
export function validateTransitionRequest(request) {
  const required = ['executionId', 'newStatus', 'expectedVersion', 'actor'];

  for (const field of required) {
    if (request[field] === undefined || request[field] === null) {
      const error = new Error(
        `TransitionRequest missing required field: ${field}`
      );
      logger.error({
        request,
        missingField: field,
        error: error.message,
      }, 'Transition request validation failed');

      return { valid: false, error };
    }
  }

  // Validate expectedVersion is a number
  if (typeof request.expectedVersion !== 'number') {
    const error = new Error(
      `expectedVersion must be a number, got ${typeof request.expectedVersion}`
    );
    logger.error({
      request,
      error: error.message,
    }, 'Transition request validation failed: invalid expectedVersion type');

    return { valid: false, error };
  }

  return { valid: true };
}

/**
 * Validate Timeout Transition
 *
 * Special validation for automatic timeout transitions.
 * Ensures timeout transition is only applied to non-terminal states.
 *
 * @param {object} execution - ExecutionRequest to timeout
 * @returns {object} Validation result { valid: boolean, error?: Error }
 */
export function validateTimeoutTransition(execution) {
  const { id: executionId, status } = execution;

  // Timeout can only be applied to non-terminal states
  if (isTerminalState(status)) {
    const error = new Error(
      `Cannot timeout execution ${executionId}: already in terminal state ${status}`
    );
    logger.error({
      executionId,
      status,
      error: error.message,
    }, 'Timeout validation failed: already terminal');

    return { valid: false, error };
  }

  // Check that TIMED_OUT is a legal transition from current state
  if (!isLegalTransition(status, ExecutionStatus.TIMED_OUT)) {
    const error = new IllegalTransitionError(
      status,
      ExecutionStatus.TIMED_OUT,
      executionId
    );
    logger.error({
      executionId,
      status,
      error: error.message,
    }, 'Timeout validation failed: illegal timeout transition');

    return { valid: false, error };
  }

  return { valid: true };
}

/**
 * Validate Cancellation Request
 *
 * Special validation for user-initiated cancellation.
 * Ensures cancellation is only allowed from cancellable states.
 *
 * @param {object} execution - ExecutionRequest to cancel
 * @returns {object} Validation result { valid: boolean, error?: Error }
 */
export function validateCancellation(execution) {
  const { id: executionId, status } = execution;

  // Cannot cancel terminal states
  if (isTerminalState(status)) {
    const error = new Error(
      `Cannot cancel execution ${executionId}: already in terminal state ${status}`
    );
    logger.error({
      executionId,
      status,
      error: error.message,
    }, 'Cancellation validation failed: already terminal');

    return { valid: false, error };
  }

  // Check that CANCELLED is a legal transition from current state
  if (!isLegalTransition(status, ExecutionStatus.CANCELLED)) {
    const error = new IllegalTransitionError(
      status,
      ExecutionStatus.CANCELLED,
      executionId
    );
    logger.error({
      executionId,
      status,
      error: error.message,
    }, 'Cancellation validation failed: illegal cancellation transition');

    return { valid: false, error };
  }

  return { valid: true };
}
