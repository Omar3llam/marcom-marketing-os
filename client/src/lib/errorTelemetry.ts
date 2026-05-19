/**
 * Error Telemetry Hooks (Phase 10D)
 *
 * Observability layer for error intelligence.
 * Tracks errors, retries, failures, and recovery patterns.
 *
 * This becomes the future analytics spine for failure analysis.
 *
 * @example
 * ```ts
 * import { trackError, trackRetryAttempt } from '@/lib/errorTelemetry';
 *
 * try {
 *   await fetchFeed();
 * } catch (error) {
 *   trackError(error, { component: 'DecisionFeed', action: 'fetchFeed' });
 *   if (shouldRetry(error)) {
 *     trackRetryAttempt(error, { attempt: 1, delay: 2000 });
 *   }
 * }
 * ```
 */

import { track } from './telemetry';
import { serializeError, type AppError } from '../contracts/errors/index';

/**
 * Track error occurrence
 *
 * Logs error with full metadata for failure analysis.
 * Includes severity, classification, correlation IDs, stack trace.
 *
 * @param error - AppError instance
 * @param context - Additional context (component, user action, etc.)
 */
export function trackError(
  error: AppError | Error,
  context?: {
    component?: string;
    action?: string;
    userId?: string;
    [key: string]: unknown;
  }
): void {
  const serialized = serializeError(error);

  track('error_occurred', {
    ...serialized,
    errorName: serialized.name,
    errorCode: serialized.code,
    errorSeverity: serialized.severity,
    errorClassification: serialized.classification,
    isRetryable: serialized.retryable,
    requestId: serialized.requestId,
    sessionId: serialized.sessionId,
    timestamp: serialized.timestamp,
    context: {
      ...serialized.context,
      ...context,
    },
    // Stack trace (truncated for telemetry payload size)
    stackPreview: serialized.stack?.split('\n').slice(0, 5).join('\n'),
  });
}

/**
 * Track retry attempt
 *
 * Logs retry behavior for failure recovery analysis.
 * Helps identify retry storms, exponential backoff effectiveness.
 *
 * @param error - Error being retried
 * @param retryContext - Retry attempt details
 */
export function trackRetryAttempt(
  error: AppError | Error,
  retryContext: {
    attempt: number;
    delay: number;
    maxAttempts?: number;
    strategy?: string;
  }
): void {
  const serialized = serializeError(error);

  track('error_retry_attempt', {
    errorCode: serialized.code,
    errorClassification: serialized.classification,
    requestId: serialized.requestId,
    sessionId: serialized.sessionId,
    attempt: retryContext.attempt,
    delay: retryContext.delay,
    maxAttempts: retryContext.maxAttempts,
    strategy: retryContext.strategy,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track circuit breaker state change
 *
 * Logs circuit breaker open/close events for resilience monitoring.
 * Circuit breakers prevent cascading failures.
 *
 * @param params - Circuit breaker event details
 */
export function trackCircuitBreakerOpen(params: {
  service: string;
  endpoint: string;
  failureCount: number;
  threshold: number;
  openDuration?: number;
}): void {
  track('circuit_breaker_open', {
    service: params.service,
    endpoint: params.endpoint,
    failureCount: params.failureCount,
    threshold: params.threshold,
    openDuration: params.openDuration,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track circuit breaker closed
 *
 * Logs when circuit breaker closes after recovery period.
 *
 * @param params - Circuit breaker close details
 */
export function trackCircuitBreakerClosed(params: {
  service: string;
  endpoint: string;
  downtime: number;
}): void {
  track('circuit_breaker_closed', {
    service: params.service,
    endpoint: params.endpoint,
    downtime: params.downtime,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track stream recovery
 *
 * Logs SSE/WebSocket reconnection success for reliability monitoring.
 *
 * @param params - Stream recovery details
 */
export function trackStreamRecovery(params: {
  streamType: 'sse' | 'websocket';
  endpoint: string;
  downtime: number;
  reconnectAttempts: number;
}): void {
  track('stream_recovered', {
    streamType: params.streamType,
    endpoint: params.endpoint,
    downtime: params.downtime,
    reconnectAttempts: params.reconnectAttempts,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track stream failure
 *
 * Logs stream disconnect/failure for reliability monitoring.
 *
 * @param params - Stream failure details
 */
export function trackStreamFailure(params: {
  streamType: 'sse' | 'websocket';
  endpoint: string;
  error: Error | AppError;
  willRetry: boolean;
}): void {
  const serialized = serializeError(params.error);

  track('stream_failed', {
    streamType: params.streamType,
    endpoint: params.endpoint,
    errorCode: serialized.code,
    errorMessage: serialized.message,
    willRetry: params.willRetry,
    requestId: serialized.requestId,
    sessionId: serialized.sessionId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track error resolution
 *
 * Logs when error is successfully resolved (retry succeeded, user recovered).
 * Helps measure MTTR (Mean Time To Recovery).
 *
 * @param params - Resolution details
 */
export function trackErrorResolution(params: {
  errorCode: string;
  resolutionMethod: 'retry' | 'user_action' | 'auto_recovery';
  timeToResolve: number;
  requestId?: string;
}): void {
  track('error_resolved', {
    errorCode: params.errorCode,
    resolutionMethod: params.resolutionMethod,
    timeToResolve: params.timeToResolve,
    requestId: params.requestId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track degraded state
 *
 * Logs when system enters degraded mode (partial functionality).
 * Helps identify cascading failures.
 *
 * @param params - Degraded state details
 */
export function trackDegradedState(params: {
  feature: string;
  degradationType: 'partial' | 'fallback' | 'disabled';
  cause: string;
}): void {
  track('system_degraded', {
    feature: params.feature,
    degradationType: params.degradationType,
    cause: params.cause,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track error boundary catch
 *
 * Logs React error boundary catches for component failure monitoring.
 *
 * @param params - Error boundary event
 */
export function trackErrorBoundary(params: {
  boundaryId: string;
  error: Error;
  errorInfo?: { componentStack?: string };
}): void {
  const serialized = serializeError(params.error);

  track('error_boundary_catch', {
    boundaryId: params.boundaryId,
    errorName: serialized.name,
    errorMessage: serialized.message,
    componentStack: params.errorInfo?.componentStack,
    timestamp: new Date().toISOString(),
  });
}
