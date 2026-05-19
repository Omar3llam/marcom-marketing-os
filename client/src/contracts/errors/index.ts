/**
 * Error Classes — Typed error hierarchy for MARCOM (Phase 10)
 *
 * Provides structured error handling across the application:
 * - AppError: Base class with severity, retry intelligence, correlation IDs
 * - ParsingError: Contract validation failures (schema drift)
 * - ApiError: HTTP/network request failures
 * - Domain Errors: AuthError, RateLimitError, DecisionEngineError, etc.
 *
 * @example
 * ```ts
 * import { ParsingError, AuthError, StreamDisconnectError } from '@/contracts/errors';
 *
 * // Parsing error
 * throw new ParsingError({
 *   message: 'Invalid response',
 *   schema: 'LumiFeedResponseSchema',
 *   issues: result.error.issues,
 * });
 *
 * // Domain error
 * throw new AuthError({
 *   message: 'Session expired',
 *   code: 'AUTH_SESSION_EXPIRED',
 *   fallbackAction: 'Please log in again',
 * });
 * ```
 */

// Base error
export { AppError, type ErrorConfig, type ErrorClassification, type ErrorSeverity } from './AppError';

// Transport errors (legacy, prefer domain errors)
export { ParsingError, type ParsingErrorConfig } from './ParsingError';
export { ApiError, type ApiErrorConfig } from './ApiError';

// Domain errors (Phase 10)
export {
  AuthError,
  RateLimitError,
  DecisionEngineError,
  WorkspaceError,
  ContractSyncError,
  StreamDisconnectError,
  ExecutionError,
  NetworkError,
  PlatformError,
  ValidationError,
} from './DomainErrors';

// Error serialization (Phase 10)
export {
  serializeError,
  deserializeError,
  isSerializable,
  safeSerialize,
  type SerializedError,
} from './serialization';

// Retry policy (Phase 10)
export {
  getRetryStrategy,
  calculateRetryDelay,
  executeWithRetry,
  shouldRetry,
  RETRY_POLICY,
  EXPONENTIAL_BACKOFF,
  LINEAR_RECONNECT,
  FIXED_INTERVAL,
  NO_RETRY,
  type RetryStrategy,
  type RetryStrategyType,
} from './retryPolicy';
