// ============================================================
// Execution Transition Rules
// Phase 11B Task 3: ExecutionLifecycleService foundation
//
// Encapsulates state transition matrix + timeout policies.
// This module provides the "laws of physics" for execution state.
// ============================================================

import {
  ExecutionStatus,
  STATE_TRANSITION_MATRIX,
  isTerminalState,
  getAllowedNextStates,
} from '../../types/execution.js';

/**
 * Timeout Policy Constants
 *
 * Defines maximum allowed duration for each non-terminal state.
 * After timeout, execution automatically transitions to TIMED_OUT.
 */
export const TIMEOUT_POLICY = Object.freeze({
  // PENDING → QUEUED: 5 minutes max (campaign upload → queue)
  [ExecutionStatus.PENDING]: 5 * 60 * 1000,

  // QUEUED → EXECUTING: 10 minutes max (queue → worker pickup)
  [ExecutionStatus.QUEUED]: 10 * 60 * 1000,

  // EXECUTING → terminal: 2 minutes max (Meta API call duration)
  [ExecutionStatus.EXECUTING]: 2 * 60 * 1000,

  // Terminal states have no timeout (immutable)
  [ExecutionStatus.EXECUTED_SUCCESS]: null,
  [ExecutionStatus.EXECUTED_FAILED]: null,
  [ExecutionStatus.TIMED_OUT]: null,
  [ExecutionStatus.CANCELLED]: null,
});

/**
 * Get Timeout for Execution Status
 *
 * Returns timeout duration in milliseconds for given status.
 * Returns null for terminal states (no timeout).
 *
 * @param {string} status - ExecutionStatus value
 * @returns {number|null} Timeout in ms, or null if terminal
 */
export function getTimeoutForStatus(status) {
  return TIMEOUT_POLICY[status];
}

/**
 * Check if Execution is Timed Out
 *
 * Compares current time against execution's updatedAt + timeout policy.
 * Used by timeout handler to detect zombie executions.
 *
 * @param {object} execution - ExecutionRequest from database
 * @param {Date} now - Current timestamp (injectable for testing)
 * @returns {boolean} true if execution exceeded timeout for its status
 */
export function isExecutionTimedOut(execution, now = new Date()) {
  const { status, updatedAt } = execution;

  // Terminal states never timeout
  if (isTerminalState(status)) {
    return false;
  }

  const timeout = getTimeoutForStatus(status);
  if (timeout === null) {
    return false;
  }

  const elapsed = now - new Date(updatedAt);
  return elapsed > timeout;
}

/**
 * Calculate Next Retry Time
 *
 * Exponential backoff: 2^attempt * base delay.
 * Used for retry metadata population.
 *
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @param {number} baseDelay - Base delay in ms (default: 1000)
 * @param {number} maxDelay - Maximum delay cap in ms (default: 60000)
 * @returns {Date} Next retry timestamp
 */
export function calculateNextRetry(attempt, baseDelay = 1000, maxDelay = 60000) {
  const delay = Math.min(Math.pow(2, attempt) * baseDelay, maxDelay);
  return new Date(Date.now() + delay);
}

/**
 * Transition Actor Types
 *
 * Defines who/what initiated a state transition.
 * Used for audit logging + telemetry.
 *
 * IMPORTANT: Values must match Prisma TransitionActor enum exactly.
 */
export const TransitionActor = Object.freeze({
  WORKER: 'WORKER',               // BullMQ worker executing job
  TIMEOUT_HANDLER: 'TIMEOUT_HANDLER', // Automatic timeout daemon
  USER: 'USER',                   // Direct user action (cancel)
  API: 'API',                     // REST API endpoint
  RECONCILIATION: 'RECONCILIATION', // Frontend reconciliation after disconnect
  RETRY_POLICY: 'RETRY_POLICY',   // Automatic retry after failure
  SYSTEM: 'SYSTEM',               // Internal system transition
});

/**
 * Get Transition Matrix
 *
 * Returns immutable copy of STATE_TRANSITION_MATRIX.
 * Exported for external consumers who need to inspect allowed transitions.
 *
 * @returns {object} Frozen state transition matrix
 */
export function getTransitionMatrix() {
  return STATE_TRANSITION_MATRIX;
}

export {
  ExecutionStatus,
  isTerminalState,
  getAllowedNextStates,
};
