// ============================================================
// @marcom/runtime-contracts · Timeout policy
// ============================================================
// Maximum allowed duration per non-terminal state. After timeout,
// execution automatically transitions to TIMED_OUT (via lifecycle
// service).
// ============================================================
import { ExecutionStatus, isTerminalState } from './executionStatus.js';

/** Maximum allowed duration per non-terminal status, in milliseconds. */
export const TIMEOUT_POLICY = Object.freeze({
  [ExecutionStatus.PENDING]:   5 * 60 * 1000,  // 5 min — campaign upload → queue
  [ExecutionStatus.QUEUED]:    10 * 60 * 1000, // 10 min — queue → worker pickup
  [ExecutionStatus.EXECUTING]: 2 * 60 * 1000,  // 2 min — Meta API call duration

  // Terminal states have no timeout (immutable)
  [ExecutionStatus.EXECUTED_SUCCESS]: null,
  [ExecutionStatus.EXECUTED_FAILED]: null,
  [ExecutionStatus.TIMED_OUT]:       null,
  [ExecutionStatus.CANCELLED]:       null,
});

/**
 * Return timeout duration in ms for a status (null for terminal).
 */
export function getTimeoutForStatus(status) {
  return TIMEOUT_POLICY[status];
}

/**
 * Return overage in ms if `elapsedMs` exceeded the status' budget,
 * otherwise null. Status not in the policy (e.g. terminal states or
 * unrecognized values) → null.
 */
export function getTimeoutOverageMs(status, elapsedMs) {
  const budget = TIMEOUT_POLICY[status];
  if (budget == null) return null;
  if (elapsedMs == null || !Number.isFinite(elapsedMs)) return null;
  if (elapsedMs <= budget) return null;
  return elapsedMs - budget;
}

/**
 * Detect zombie executions: in-flight + held past their policy budget.
 * Used by timeout handler to identify candidates for automatic
 * TIMED_OUT transition.
 *
 * @param {object} execution - { status, updatedAt }
 * @param {Date} [now] - injectable for testing
 */
export function isExecutionTimedOut(execution, now = new Date()) {
  const { status, updatedAt } = execution;
  if (isTerminalState(status)) return false;
  const timeout = getTimeoutForStatus(status);
  if (timeout == null) return false;
  const elapsed = now - new Date(updatedAt);
  return elapsed > timeout;
}
