// ============================================================
// MARCOM — ExecutionStatus Constants + State Transition Matrix
// Phase 11B Task 1: Backend execution status foundation
//
// Governance Constraint A: Explicit State Transition Matrix
// All transitions must be declared here. Reject everything else
// at service boundary. No implicit transitions. No auto-healing.
// ============================================================

/**
 * ExecutionStatus Constants (Backend)
 *
 * Frozen object providing enum-like behavior in JavaScript.
 * Prevents accidental mutation and enables consistent status values.
 */
export const ExecutionStatus = Object.freeze({
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING',
  EXECUTED_SUCCESS: 'EXECUTED_SUCCESS',
  EXECUTED_FAILED: 'EXECUTED_FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
});

/**
 * Terminal State Check
 *
 * Terminal states are immutable — no retries, no reopen, no mutation
 * except audit append. Treat like cooled lava. 🌋
 */
export function isTerminalState(status) {
  return (
    status === ExecutionStatus.EXECUTED_SUCCESS ||
    status === ExecutionStatus.EXECUTED_FAILED ||
    status === ExecutionStatus.TIMED_OUT ||
    status === ExecutionStatus.CANCELLED
  );
}

/**
 * State Transition Matrix
 *
 * Explicit allowed transitions. Everything not listed here is ILLEGAL.
 * No "best effort" transitions. No implicit state mutation.
 */
export const STATE_TRANSITION_MATRIX = Object.freeze({
  [ExecutionStatus.PENDING]: Object.freeze([
    ExecutionStatus.QUEUED,
    ExecutionStatus.CANCELLED,
  ]),

  [ExecutionStatus.QUEUED]: Object.freeze([
    ExecutionStatus.EXECUTING,
    ExecutionStatus.CANCELLED,
  ]),

  [ExecutionStatus.EXECUTING]: Object.freeze([
    ExecutionStatus.EXECUTED_SUCCESS,
    ExecutionStatus.EXECUTED_FAILED,
    ExecutionStatus.TIMED_OUT,
    ExecutionStatus.CANCELLED,
  ]),

  // Terminal states: no outbound transitions (immutable)
  [ExecutionStatus.EXECUTED_SUCCESS]: Object.freeze([]),
  [ExecutionStatus.EXECUTED_FAILED]: Object.freeze([]),
  [ExecutionStatus.TIMED_OUT]: Object.freeze([]),
  [ExecutionStatus.CANCELLED]: Object.freeze([]),
});

/**
 * Validate State Transition
 *
 * Returns true if transition is legal according to STATE_TRANSITION_MATRIX.
 * Use this at ExecutionLifecycleService boundary to reject illegal transitions.
 *
 * @param {string} fromStatus - Current execution status
 * @param {string} toStatus - Desired next status
 * @returns {boolean} true if transition is allowed, false otherwise
 */
export function isLegalTransition(fromStatus, toStatus) {
  const allowedTransitions = STATE_TRANSITION_MATRIX[fromStatus];
  return allowedTransitions ? allowedTransitions.includes(toStatus) : false;
}

/**
 * Get Allowed Next States
 *
 * Returns array of valid next states from current state.
 * Empty array for terminal states.
 *
 * @param {string} currentStatus - Current execution status
 * @returns {string[]} Array of allowed next statuses
 */
export function getAllowedNextStates(currentStatus) {
  return STATE_TRANSITION_MATRIX[currentStatus] || [];
}

/**
 * Transition Validation Error
 *
 * Thrown when attempting illegal state transition.
 * Captured by ExecutionLifecycleService for telemetry + audit.
 */
export class IllegalTransitionError extends Error {
  constructor(fromStatus, toStatus, executionId = null) {
    super(
      `Illegal state transition: ${fromStatus} → ${toStatus}` +
      (executionId ? ` (execution: ${executionId})` : '')
    );
    this.name = 'IllegalTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.executionId = executionId;
  }
}

/**
 * Validate ExecutionReconciliationPayload
 *
 * Ensures reconciliation payload from GET /api/execution/active
 * contains all required fields (Architecture Gate Decision 1).
 *
 * @param {object} payload - Reconciliation payload to validate
 * @returns {boolean} true if valid, throws Error otherwise
 */
export function validateReconciliationPayload(payload) {
  const required = [
    'executionId',
    'status',
    'version',
    'updatedAt',
    'correlationId',
    'isTerminal',
  ];

  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null) {
      throw new Error(
        `ReconciliationPayload missing required field: ${field}`
      );
    }
  }

  // Validate status is a known ExecutionStatus value
  if (!Object.values(ExecutionStatus).includes(payload.status)) {
    throw new Error(
      `ReconciliationPayload has invalid status: ${payload.status}`
    );
  }

  return true;
}

/**
 * Create ExecutionReconciliationPayload
 *
 * Factory function ensuring all required fields are present.
 * Used by GET /api/execution/active endpoint.
 *
 * @param {object} execution - ExecutionRequest from database
 * @returns {object} Valid ExecutionReconciliationPayload
 */
export function createReconciliationPayload(execution) {
  return {
    executionId: execution.id,
    status: execution.status,
    version: execution.version ?? 0,
    updatedAt: execution.updatedAt?.toISOString() || new Date().toISOString(),
    correlationId: execution.correlationId || execution.id,
    activeStep: execution.activeStep || null,
    retryMetadata: execution.retryMetadata
      ? {
          attempt: execution.retryMetadata.attempt || 0,
          maxAttempts: execution.retryMetadata.maxAttempts || 3,
          nextRetryAt: execution.retryMetadata.nextRetryAt || null,
        }
      : null,
    isTerminal: isTerminalState(execution.status),
  };
}
