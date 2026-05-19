// ============================================================
// MARCOM / Lumi — Backend Error Telemetry (Phase 11D)
// ------------------------------------------------------------
// Structured error tracking for backend services.
// Matches frontend errorTelemetry API for consistency.
// ============================================================
import { logger } from '../utils/logger.js';

/**
 * Track degraded state (partial failure, fallback mode)
 *
 * @param {object} args
 * @param {string} args.feature - Feature affected (e.g., 'creative_generation')
 * @param {string} args.degradationType - Type of degradation (e.g., 'openai_failure')
 * @param {string} args.cause - Root cause code (e.g., 'OPENAI_ERROR')
 * @param {object} [args.metadata] - Additional context
 */
export function trackDegradedState({ feature, degradationType, cause, metadata = {} }) {
  logger.warn({
    event: 'degraded_state',
    feature,
    degradationType,
    cause,
    ...metadata,
  }, `[Telemetry] Degraded state: ${feature} (${degradationType})`);

  // Future: Send to observability platform (Datadog, Sentry, etc.)
  // Example: datadogClient.increment('marcom.degraded_state', 1, { feature, type: degradationType });
}

/**
 * Track error occurrence
 *
 * @param {Error} error - Error object
 * @param {object} [context] - Additional context
 */
export function trackError(error, context = {}) {
  logger.error({
    event: 'error_tracked',
    errorMessage: error.message,
    errorCode: error.code,
    errorStack: error.stack,
    ...context,
  }, `[Telemetry] Error: ${error.message}`);
}

/**
 * Track retry attempt
 *
 * @param {Error} error - Original error
 * @param {object} retryContext - Retry context
 * @param {number} retryContext.attempt - Current attempt number
 * @param {number} retryContext.delay - Delay before retry (ms)
 * @param {number} retryContext.maxAttempts - Maximum attempts
 * @param {string} retryContext.strategy - Retry strategy (e.g., 'exponential_backoff')
 */
export function trackRetryAttempt(error, retryContext) {
  logger.info({
    event: 'retry_attempt',
    errorMessage: error.message,
    errorCode: error.code,
    ...retryContext,
  }, `[Telemetry] Retry ${retryContext.attempt}/${retryContext.maxAttempts} after ${retryContext.delay}ms`);
}

/**
 * Track error resolution
 *
 * @param {object} args
 * @param {string} args.errorCode - Original error code
 * @param {string} args.resolutionMethod - How it was resolved (e.g., 'retry', 'fallback')
 * @param {number} args.timeToResolve - Time taken to resolve (ms)
 * @param {string} [args.requestId] - Request ID for tracing
 */
export function trackErrorResolution({ errorCode, resolutionMethod, timeToResolve, requestId }) {
  logger.info({
    event: 'error_resolved',
    errorCode,
    resolutionMethod,
    timeToResolve,
    requestId,
  }, `[Telemetry] Error resolved: ${errorCode} via ${resolutionMethod} (${timeToResolve}ms)`);
}

/**
 * Track stream recovery (SSE reconnect)
 *
 * @param {object} args
 * @param {string} args.streamType - Type of stream (e.g., 'sse')
 * @param {string} args.endpoint - Stream endpoint
 * @param {number} args.downtime - Downtime duration (ms)
 * @param {number} args.reconnectAttempts - Number of reconnect attempts
 */
export function trackStreamRecovery({ streamType, endpoint, downtime, reconnectAttempts }) {
  logger.info({
    event: 'stream_recovered',
    streamType,
    endpoint,
    downtime,
    reconnectAttempts,
  }, `[Telemetry] Stream recovered: ${streamType} ${endpoint} after ${downtime}ms (${reconnectAttempts} attempts)`);
}

/**
 * Track stream failure
 *
 * @param {object} args
 * @param {string} args.streamType - Type of stream
 * @param {string} args.endpoint - Stream endpoint
 * @param {Error} args.error - Error object
 * @param {boolean} args.willRetry - Whether retry will be attempted
 */
export function trackStreamFailure({ streamType, endpoint, error, willRetry }) {
  logger.warn({
    event: 'stream_failed',
    streamType,
    endpoint,
    errorMessage: error.message,
    errorCode: error.code,
    willRetry,
  }, `[Telemetry] Stream failed: ${streamType} ${endpoint} (${error.message})`);
}

/**
 * Track circuit breaker state change
 *
 * @param {object} args
 * @param {string} args.service - Service name (e.g., 'orchestrator')
 * @param {string} args.state - New state ('OPEN', 'HALF_OPEN', 'CLOSED')
 * @param {number} args.failureCount - Failure count
 * @param {number} args.threshold - Failure threshold
 */
export function trackCircuitBreakerOpen({ service, state, failureCount, threshold }) {
  logger.warn({
    event: 'circuit_breaker_state_change',
    service,
    state,
    failureCount,
    threshold,
  }, `[Telemetry] Circuit breaker ${state}: ${service} (${failureCount}/${threshold} failures)`);
}
