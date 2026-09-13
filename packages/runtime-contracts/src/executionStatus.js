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
// ── SLICE D — TIMED_OUT was reachable from EXECUTING ONLY ───────────────────
// Four declarations describe what a timeout is, and this one disagreed with the
// other three:
//
//   PHASE_11B_LIFECYCLE_GOVERNANCE.md  PENDING → QUEUED, TIMED_OUT
//                                      QUEUED  → EXECUTING, TIMED_OUT, CANCELLED
//   TIMEOUT_POLICY                     declares a BUDGET for PENDING (5m) and
//                                      for QUEUED (10m)
//   isExecutionTimedOut()              returns true for ANY non-terminal status
//                                      holding a budget
//   this matrix                        TIMED_OUT only from EXECUTING
//
// A budget for a state that cannot legally time out is a rule with no way to
// apply. The three that agree are also the three a reader would consult, so the
// matrix is the outlier and is corrected here rather than the policy narrowed.
//
// The semantics hold either way: "backend timeout threshold exceeded" is true
// of an execution nothing ever picked up, and TIMED_OUT is already a FAILURE
// terminal that retry accepts — which is what makes a stranded execution
// recoverable instead of merely tidy. CANCELLED would have been the wrong
// answer: retry.js reads it as "conceptually a re-run", and nothing here was
// cancelled by anyone.
//
// executionLifecycleIntegrity.wiring.test.js now asserts the agreement, so the
// four declarations cannot drift apart again in silence.
export const STATE_TRANSITION_MATRIX = Object.freeze({
  [ExecutionStatus.PENDING]: Object.freeze([
    ExecutionStatus.QUEUED,
    ExecutionStatus.TIMED_OUT,
    ExecutionStatus.CANCELLED,
  ]),

  [ExecutionStatus.QUEUED]: Object.freeze([
    ExecutionStatus.EXECUTING,
    ExecutionStatus.TIMED_OUT,
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
