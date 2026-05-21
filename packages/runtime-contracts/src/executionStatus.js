// ============================================================
// @marcom/runtime-contracts · ExecutionStatus + transition matrix
// ============================================================
// Governance Constraint A: Explicit State Transition Matrix
// All transitions must be declared here. Reject everything else
// at service boundary. No implicit transitions. No auto-healing.
//
// Governance Constraint B: Terminal State Immutability
// Terminal states are immutable — no retries, no reopen, no
// mutation except audit append. Treat like cooled lava. 🌋
// ============================================================

/**
 * ExecutionStatus — frozen object providing enum-like behavior.
 * Stringly typed for cross-runtime safety (Node + browser).
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

/** Terminal statuses — immutable once reached. */
export const TERMINAL_STATUSES = Object.freeze([
  ExecutionStatus.EXECUTED_SUCCESS,
  ExecutionStatus.EXECUTED_FAILED,
  ExecutionStatus.TIMED_OUT,
  ExecutionStatus.CANCELLED,
]);

/**
 * In-flight statuses — execution is "live" and may still transition.
 * Used by Live Monitor filters + reconciliation logic.
 *
 * Includes RETRYING as a "live" categorization for the UI even though
 * it isn't in STATE_TRANSITION_MATRIX (the matrix is the strict
 * transition contract; this list is the broader "still moving"
 * concept that the operator's Live Monitor cares about).
 */
export const IN_FLIGHT_STATUSES = Object.freeze([
  ExecutionStatus.PENDING,
  ExecutionStatus.QUEUED,
  ExecutionStatus.EXECUTING,
  'RETRYING',
]);

/**
 * Failure statuses — terminal but unsuccessful. Retry candidates.
 * Distinct from `TERMINAL_STATUSES` which also includes SUCCESS/CANCELLED.
 */
export const FAILURE_STATUSES = Object.freeze([
  ExecutionStatus.EXECUTED_FAILED,
  ExecutionStatus.TIMED_OUT,
]);

export function isTerminalState(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function isInFlightState(status) {
  return IN_FLIGHT_STATUSES.includes(status);
}

export function isFailureState(status) {
  return FAILURE_STATUSES.includes(status);
}

/**
 * State Transition Matrix — explicit allowed transitions.
 * Everything not listed here is ILLEGAL. No "best effort" transitions.
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

export function isLegalTransition(fromStatus, toStatus) {
  const allowedTransitions = STATE_TRANSITION_MATRIX[fromStatus];
  return allowedTransitions ? allowedTransitions.includes(toStatus) : false;
}

export function getAllowedNextStates(currentStatus) {
  return STATE_TRANSITION_MATRIX[currentStatus] || [];
}

export function getTransitionMatrix() {
  return STATE_TRANSITION_MATRIX;
}

/**
 * Thrown when attempting an illegal state transition.
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
