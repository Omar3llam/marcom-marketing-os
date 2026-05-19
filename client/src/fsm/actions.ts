/**
 * FSM Actions (Phase 11)
 *
 * Side effects triggered by state transitions.
 * Handles telemetry, circuit breaker state, and context updates.
 */
import { assign } from 'xstate';
import { track } from '@/lib/telemetry';
import {
  trackError,
  trackRetryAttempt,
  trackErrorResolution,
  trackDegradedState,
  trackCircuitBreakerOpen,
  trackCircuitBreakerClosed,
} from '@/lib/errorTelemetry';
import type { DecisionContext } from './decisionMachine';

// ══════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════

const RETRY_BASE_DELAY = 2000; // 2s
const RETRY_MAX_DELAY = 32_000; // 32s
const RETRY_MAX_ATTEMPTS = 5;
const CIRCUIT_BREAKER_OPEN_DURATION = 60_000; // 60s

// ══════════════════════════════════════════════════════════════
// Telemetry Actions
// ══════════════════════════════════════════════════════════════

/**
 * Track state transition for observability
 */
export function trackTransition(
  context: DecisionContext,
  event: any,
  meta: { from: string; to: string; reason?: string }
) {
  const elapsed = Date.now() - context.stateStartTime;
  track('fsm_transition', {
    from: meta.from,
    to: meta.to,
    reason: meta.reason,
    elapsed,
    actionId: context.actionId,
    retryCount: context.retryCount,
    mode: context.mode,
  });
}

/**
 * Track error occurrence
 */
export function trackErrorOccurred(context: DecisionContext) {
  if (context.error) {
    trackError(context.error, {
      component: 'DecisionMachine',
      action: 'execution',
      actionId: context.actionId || undefined,
    });
  }
}

/**
 * Track retry attempt
 */
export function trackRetryAction(context: DecisionContext) {
  if (context.error) {
    trackRetryAttempt(context.error, {
      attempt: context.retryCount + 1,
      delay: context.retryDelay,
      maxAttempts: RETRY_MAX_ATTEMPTS,
      strategy: 'exponential_backoff',
    });
  }
}

/**
 * Track error resolution
 */
export function trackResolution(context: DecisionContext) {
  if (context.error) {
    const timeToResolve =
      Date.now() - (context.lastRetryTime || context.executionStartTime || Date.now());
    trackErrorResolution({
      errorCode: context.error.code || 'UNKNOWN',
      resolutionMethod: context.retryCount > 0 ? 'retry' : 'auto_recovery',
      timeToResolve,
      requestId: context.error.requestId,
    });
  }
}

/**
 * Track degraded state
 */
export function trackDegraded(context: DecisionContext) {
  trackDegradedState({
    feature: 'decision_execution',
    degradationType: 'fallback',
    cause: context.circuitOpen ? 'circuit_breaker_open' : 'orchestrator_failure',
  });
}

/**
 * Track circuit breaker open
 */
export function trackCircuitOpen(context: DecisionContext) {
  trackCircuitBreakerOpen({
    service: 'orchestrator',
    endpoint: '/api/lumi/analyze',
    failureCount: context.retryCount,
    threshold: 3,
    openDuration: CIRCUIT_BREAKER_OPEN_DURATION,
  });
}

/**
 * Track circuit breaker closed
 */
export function trackCircuitClosed(context: DecisionContext) {
  const downtime = context.circuitOpenUntil
    ? context.circuitOpenUntil - Date.now()
    : CIRCUIT_BREAKER_OPEN_DURATION;

  trackCircuitBreakerClosed({
    service: 'orchestrator',
    endpoint: '/api/lumi/analyze',
    downtime,
  });
}

// ══════════════════════════════════════════════════════════════
// Context Update Actions
// ══════════════════════════════════════════════════════════════

/**
 * Open circuit breaker
 */
export const openCircuit = assign({
  circuitOpen: true,
  circuitOpenUntil: Date.now() + CIRCUIT_BREAKER_OPEN_DURATION,
});

/**
 * Close circuit breaker
 */
export const closeCircuit = assign({
  circuitOpen: false,
  circuitOpenUntil: null,
});

/**
 * Increment retry count and calculate exponential backoff delay
 */
export const incrementRetry = assign({
  retryCount: ({ context }: { context: DecisionContext }) => context.retryCount + 1,
  retryDelay: ({ context }: { context: DecisionContext }) => {
    const attempt = context.retryCount + 1;
    const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt - 1), RETRY_MAX_DELAY);
    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  },
  lastRetryTime: Date.now(),
});

/**
 * Reset retry state
 */
export const resetRetry = assign({
  retryCount: 0,
  retryDelay: RETRY_BASE_DELAY,
  lastRetryTime: null,
});

/**
 * Set execution timeout (90s from now)
 */
export const setExecutionTimeout = assign({
  executionStartTime: Date.now(),
  executionTimeoutAt: Date.now() + 90_000, // 90s
});

/**
 * Clear execution timeout
 */
export const clearExecutionTimeout = assign({
  executionStartTime: null,
  executionTimeoutAt: null,
});

/**
 * Mark SSE as dropped
 */
export const markSseDropped = assign({
  sseDropped: true,
  pollAttempts: 0,
});

/**
 * Increment SSE poll attempts
 */
export const incrementPollAttempts = assign({
  pollAttempts: ({ context }: { context: DecisionContext }) => context.pollAttempts + 1,
});

/**
 * Reset SSE state
 */
export const resetSseState = assign({
  sseDropped: false,
  pollAttempts: 0,
  sseConnected: true,
});

/**
 * Update state start time (for elapsed tracking)
 */
export const updateStateStartTime = assign({
  stateStartTime: Date.now(),
});

/**
 * Store error in context
 */
export const storeError = assign({
  error: (_: any, params: any) => params.error,
});

/**
 * Clear error from context
 */
export const clearError = assign({
  error: null,
});

/**
 * Store output data
 */
export const storeOutput = assign({
  outputData: (_: any, params: any) => params.data,
});

/**
 * Store action ID and idempotency key
 */
export const storeActionId = assign({
  actionId: (_: any, params: any) => params.actionId,
  idempotencyKey: (_: any, params: any) => params.idempotencyKey,
});

/**
 * Store input data
 */
export const storeInputData = assign({
  inputData: (_: any, params: any) => params.data,
});

/**
 * Store mode
 */
export const storeMode = assign({
  mode: (_: any, params: any) => params.mode,
});

/**
 * Commit to history (on success)
 */
export const commitToHistory = assign({
  history: ({ context }: { context: DecisionContext }) =>
    [context.outputData, ...context.history].slice(0, 20),
});

/**
 * Reset to initial state
 */
export const resetToInitial = assign({
  mode: null,
  inputData: null,
  outputData: null,
  actionId: null,
  idempotencyKey: null,
  executionStartTime: null,
  error: null,
  retryCount: 0,
  retryDelay: RETRY_BASE_DELAY,
  lastRetryTime: null,
  sseDropped: false,
  pollAttempts: 0,
  executionTimeoutAt: null,
  // Keep history and radarAlerts
});
