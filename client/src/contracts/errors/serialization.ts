/**
 * Error Serialization Layer (Phase 10)
 *
 * Enables errors to cross boundaries:
 * - Telemetry pipelines
 * - SSE/WebSocket streams
 * - Background workers
 * - Log aggregation
 *
 * Why: Errors need to be JSON-serializable for distributed systems.
 * Native Error objects lose critical metadata (stack, cause) during serialization.
 *
 * @example
 * ```ts
 * import { serializeError, deserializeError } from '@/contracts/errors';
 *
 * // Serialize for telemetry
 * const serialized = serializeError(error);
 * track('error_occurred', serialized);
 *
 * // Deserialize from SSE stream
 * const payload = JSON.parse(event.data);
 * const error = deserializeError(payload.error);
 * ```
 */

import {
  AppError,
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
  ParsingError,
  ApiError,
  type ErrorClassification,
  type ErrorSeverity,
} from './index';

/**
 * Serialized error format
 *
 * JSON-safe representation of any AppError subclass.
 * Preserves all metadata needed for reconstruction.
 */
export interface SerializedError {
  /** Error name (e.g., 'AuthError', 'DecisionEngineError') */
  name: string;

  /** Human-readable error message */
  message: string;

  /** Machine-readable error code */
  code: string;

  /** Error classification */
  classification: ErrorClassification;

  /** Error severity */
  severity: ErrorSeverity;

  /** Whether error can be retried */
  retryable: boolean;

  /** User-facing recovery guidance */
  fallbackAction?: string;

  /** HTTP status code if applicable */
  httpStatus?: number;

  /** Request correlation ID */
  requestId?: string;

  /** Session ID */
  sessionId?: string;

  /** Timestamp ISO string */
  timestamp: string;

  /** Additional context */
  context?: Record<string, unknown>;

  /** Stack trace */
  stack?: string;

  /** Serialized cause error (if present) */
  cause?: SerializedError;

  /** Zod issues (for ParsingError) */
  issues?: Array<{
    path: string;
    message: string;
    code: string;
  }>;

  /** API endpoint (for ApiError/ParsingError) */
  endpoint?: string;

  /** Schema name (for ParsingError) */
  schema?: string;
}

/**
 * Serialize error to JSON-safe object
 *
 * Converts any Error (native or AppError subclass) into
 * a JSON-serializable format that preserves metadata.
 *
 * @param error - Error to serialize
 * @returns JSON-safe serialized error
 */
export function serializeError(error: Error | AppError): SerializedError {
  // Handle AppError and subclasses
  if (error instanceof AppError) {
    const serialized: SerializedError = {
      name: error.constructor.name,
      message: error.message,
      code: error.code,
      classification: error.classification,
      severity: error.severity,
      retryable: error.retryable,
      fallbackAction: error.fallbackAction,
      httpStatus: error.httpStatus,
      requestId: error.requestId,
      sessionId: error.sessionId,
      timestamp: error.timestamp.toISOString(),
      context: error.context,
      stack: error.stack,
    };

    // Serialize cause recursively
    if (error.cause) {
      serialized.cause = serializeError(error.cause);
    }

    // ParsingError-specific fields
    if (error instanceof ParsingError) {
      serialized.issues = error.issues?.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
      serialized.endpoint = error.endpoint;
      serialized.schema = error.schema;
    }

    // ApiError-specific fields
    if (error instanceof ApiError) {
      serialized.endpoint = error.endpoint;
    }

    return serialized;
  }

  // Handle native Error
  return {
    name: error.name || 'Error',
    message: error.message,
    code: 'UNKNOWN_ERROR',
    classification: 'platform',
    severity: 'medium',
    retryable: false,
    timestamp: new Date().toISOString(),
    stack: error.stack,
  };
}

/**
 * Deserialize error from JSON
 *
 * Reconstructs an Error instance from serialized format.
 * Maps to the correct error class based on `name` field.
 *
 * @param payload - Serialized error payload
 * @returns Reconstructed error instance
 */
export function deserializeError(payload: SerializedError): AppError {
  // Reconstruct cause recursively
  const cause = payload.cause ? deserializeError(payload.cause) : undefined;

  // Base config for reconstruction
  const baseConfig = {
    message: payload.message,
    code: payload.code,
    severity: payload.severity,
    retryable: payload.retryable,
    fallbackAction: payload.fallbackAction,
    httpStatus: payload.httpStatus,
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    context: payload.context,
    cause,
  };

  // Map name to constructor
  switch (payload.name) {
    case 'AuthError':
      return new AuthError(baseConfig);

    case 'RateLimitError':
      return new RateLimitError(baseConfig);

    case 'DecisionEngineError':
      return new DecisionEngineError(baseConfig);

    case 'WorkspaceError':
      return new WorkspaceError(baseConfig);

    case 'ContractSyncError':
      return new ContractSyncError(baseConfig);

    case 'StreamDisconnectError':
      return new StreamDisconnectError(baseConfig);

    case 'ExecutionError':
      return new ExecutionError(baseConfig);

    case 'NetworkError':
      return new NetworkError(baseConfig);

    case 'PlatformError':
      return new PlatformError(baseConfig);

    case 'ValidationError':
      return new ValidationError(baseConfig);

    case 'ParsingError':
      return new ParsingError({
        ...baseConfig,
        classification: payload.classification,
        endpoint: payload.endpoint || '',
        schema: payload.schema || '',
        issues: payload.issues?.map(issue => ({
          path: issue.path.split('.'),
          message: issue.message,
          code: issue.code,
        })),
      });

    case 'ApiError':
      return new ApiError({
        ...baseConfig,
        classification: payload.classification,
        endpoint: payload.endpoint || '',
      });

    default:
      // Fallback to generic AppError
      return new AppError({
        ...baseConfig,
        classification: payload.classification,
      });
  }
}

/**
 * Check if an error is serializable
 *
 * Validates that an error can be safely serialized.
 * Useful for pre-serialization checks.
 *
 * @param error - Error to check
 * @returns True if error is serializable
 */
export function isSerializable(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Safely serialize unknown error
 *
 * Handles cases where error might not be an Error instance.
 * Converts strings, objects, and other types to SerializedError format.
 *
 * @param error - Unknown error value
 * @returns Serialized error
 */
export function safeSerialize(error: unknown): SerializedError {
  if (error instanceof Error) {
    return serializeError(error);
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
      code: 'UNKNOWN_ERROR',
      classification: 'platform',
      severity: 'medium',
      retryable: false,
      timestamp: new Date().toISOString(),
    };
  }

  if (typeof error === 'object' && error !== null) {
    return {
      name: 'Error',
      message: JSON.stringify(error),
      code: 'UNKNOWN_ERROR',
      classification: 'platform',
      severity: 'medium',
      retryable: false,
      timestamp: new Date().toISOString(),
      context: error as Record<string, unknown>,
    };
  }

  return {
    name: 'Error',
    message: 'Unknown error occurred',
    code: 'UNKNOWN_ERROR',
    classification: 'platform',
    severity: 'medium',
    retryable: false,
    timestamp: new Date().toISOString(),
  };
}
