/**
 * FSM Transition Guards (Phase 11)
 *
 * Centralized guard logic for state machine transitions.
 * Prevents impossible states and enforces execution constraints.
 */
import type { DecisionContext } from './decisionMachine';

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const RETRY_MAX_ATTEMPTS = 5;
const SSE_POLL_MAX_ATTEMPTS = 10;

// ══════════════════════════════════════════════════════════════
// Guard Functions
// ══════════════════════════════════════════════════════════════

/**
 * Check if retry budget exhausted
 */
export function canRetry(context: DecisionContext): boolean {
  return context.retryCount < RETRY_MAX_ATTEMPTS;
}

/**
 * Check if circuit breaker is open
 */
export function isCircuitOpen(context: DecisionContext): boolean {
  if (!context.circuitOpen) return false;
  if (!context.circuitOpenUntil) return false;

  // Circuit auto-closes after timeout
  if (Date.now() > context.circuitOpenUntil) {
    return false; // Circuit closed
  }

  return true; // Circuit still open
}

/**
 * Check if circuit breaker should close (after timeout)
 */
export function shouldCloseCircuit(context: DecisionContext): boolean {
  if (!context.circuitOpen) return false;
  if (!context.circuitOpenUntil) return false;

  return Date.now() > context.circuitOpenUntil;
}

/**
 * Check if execution timeout exceeded
 */
export function isExecutionTimeout(context: DecisionContext): boolean {
  if (!context.executionTimeoutAt) return false;
  return Date.now() > context.executionTimeoutAt;
}

/**
 * Check if SSE connection dropped during execution
 */
export function isSseDropped(context: DecisionContext): boolean {
  return context.sseDropped && context.pollAttempts < SSE_POLL_MAX_ATTEMPTS;
}

/**
 * Check if SSE polling exhausted
 */
export function isPollingExhausted(context: DecisionContext): boolean {
  return context.pollAttempts >= SSE_POLL_MAX_ATTEMPTS;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(context: DecisionContext): boolean {
  return context.error?.retryable ?? false;
}

/**
 * Check if should escalate to circuit breaker (multiple retries failed)
 */
export function shouldOpenCircuit(context: DecisionContext): boolean {
  // Open circuit after 3 consecutive planning failures
  return context.retryCount >= 3;
}

/**
 * Check if execution is in-flight (has active timeout)
 */
export function isExecutionInFlight(context: DecisionContext): boolean {
  return context.executionTimeoutAt !== null;
}

/**
 * Check if user can cancel (execution not committed yet)
 */
export function canCancel(context: DecisionContext): boolean {
  // Can cancel if execution hasn't reached success state
  return context.executionTimeoutAt !== null;
}

/**
 * Check if should trigger degraded mode
 */
export function shouldDegrade(context: DecisionContext): boolean {
  // Degrade if circuit open or multiple orchestrator failures
  return context.circuitOpen || context.retryCount >= RETRY_MAX_ATTEMPTS;
}
