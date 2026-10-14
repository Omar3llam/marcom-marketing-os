/**
 * AppError — Base error class for all MARCOM errors
 *
 * Provides structured error handling with:
 * - Classification for error type routing
 * - Retryable flag for automatic retry logic
 * - Fallback action for user guidance
 * - HTTP status tracking for API errors
 *
 * @example
 * ```ts
 * throw new AppError({
 *   message: 'Campaign not found',
 *   classification: 'validation',
 *   retryable: false,
 *   fallbackAction: 'Check campaign ID and try again',
 *   httpStatus: 404,
 * });
 * ```
 */

/**
 * Error classification types (Phase 10: Domain-centric)
 *
 * - auth: Authentication/authorization failures
 * - network: Connection/timeout errors
 * - platform: External platform errors (Meta API, etc.)
 * - validation: Invalid request data
 * - contract: Invalid response format (contract drift)
 * - decision_engine: AI orchestration failures
 * - workspace: Workspace/tenant errors
 * - stream: SSE/WebSocket disconnect
 * - execution: Action execution failures
 * - rate_limit: Quota/throttling errors
 */
export type ErrorClassification =
  | 'auth'
  | 'network'
  | 'platform'
  | 'validation'
  | 'contract'
  | 'decision_engine'
  | 'workspace'
  | 'stream'
  | 'execution'
  | 'rate_limit'
  // Legacy aliases (deprecated)
  | 'parsing'; // Use 'contract' instead

/**
 * Error severity levels (Phase 10: UX mapping)
 *
 * - low: Toast notification (non-blocking)
 * - medium: Inline warning (degraded state)
 * - high: Panel failure (feature unavailable)
 * - critical: Route boundary (catastrophic)
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error configuration for AppError constructor
 */
export interface ErrorConfig {
  /** Human-readable error message */
  message: string;

  /** Error classification for routing and telemetry */
  classification: ErrorClassification;

  /** Machine-readable error code (e.g., 'AUTH_SESSION_EXPIRED') */
  code?: string;

  /** Error severity for UX behavior mapping */
  severity?: ErrorSeverity;

  /** Whether this error can be retried (default: true) */
  retryable?: boolean;

  /** User-facing guidance on how to recover */
  fallbackAction?: string;

  /** HTTP status code if applicable */
  httpStatus?: number;

  /** Original error that caused this error */
  cause?: Error;

  /** Additional context for debugging */
  context?: Record<string, unknown>;

  /** Correlation ID for distributed tracing */
  requestId?: string;

  /** Session ID for user journey tracking */
  sessionId?: string;
}

/**
 * Base error class for all application errors
 *
 * Extends native Error with additional metadata for
 * better error handling, retry logic, and user feedback.
 */
export class AppError extends Error {
  /** Error classification */
  readonly classification: ErrorClassification;

  /** Machine-readable error code */
  readonly code: string;

  /** Error severity for UX mapping */
  readonly severity: ErrorSeverity;

  /** Whether this error can be retried */
  readonly retryable: boolean;

  /** User-facing recovery guidance */
  readonly fallbackAction?: string;

  /** HTTP status code if applicable */
  readonly httpStatus?: number;

  /** Original error that caused this */
  readonly cause?: Error;

  /** Additional debugging context */
  readonly context?: Record<string, unknown>;

  /** Request correlation ID for distributed tracing */
  readonly requestId?: string;

  /** Session ID for user journey tracking */
  readonly sessionId?: string;

  /** Timestamp when error was created */
  readonly timestamp: Date;

  constructor(config: ErrorConfig) {
    super(config.message);

    // Maintain proper stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
    this.classification = config.classification;
    this.code = config.code || `${config.classification.toUpperCase()}_ERROR`;
    this.severity = config.severity || inferSeverity(config.classification);
    this.retryable = config.retryable ?? inferRetryable(config.classification);
    this.fallbackAction = config.fallbackAction;
    this.httpStatus = config.httpStatus;
    this.cause = config.cause;
    this.context = config.context;
    this.requestId = config.requestId;
    this.sessionId = config.sessionId;
    this.timestamp = new Date();
  }

  /**
   * Convert error to JSON for logging/telemetry
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      classification: this.classification,
      severity: this.severity,
      retryable: this.retryable,
      fallbackAction: this.fallbackAction,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      sessionId: this.sessionId,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * User-friendly error summary
   */
  toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

/**
 * Infer severity from classification
 *
 * Maps error classifications to default severity levels.
 * Can be overridden in ErrorConfig.
 */
function inferSeverity(classification: ErrorClassification): ErrorSeverity {
  switch (classification) {
    case 'auth':
      return 'high'; // Auth failures block usage

    case 'contract':
    case 'parsing':
      return 'critical'; // Contract drift is system-level

    case 'decision_engine':
      return 'high'; // AI failures degrade core function

    case 'execution':
      return 'high'; // Action execution failures need attention

    case 'rate_limit':
      return 'medium'; // Throttling is recoverable

    case 'workspace':
      return 'medium'; // Workspace errors may allow partial render

    case 'stream':
      return 'medium'; // Stream disconnect is recoverable

    case 'network':
      return 'medium'; // Network issues often transient

    case 'validation':
      return 'low'; // User input validation is non-catastrophic

    case 'platform':
      return 'high'; // External platform errors block features

    default:
      return 'medium';
  }
}

/**
 * Infer retryable from classification
 *
 * Maps error classifications to retry-safety.
 * Can be overridden in ErrorConfig.
 */
function inferRetryable(classification: ErrorClassification): boolean {
  switch (classification) {
    case 'auth':
      return false; // Auth failures need re-login, not retry

    case 'contract':
    case 'parsing':
      return false; // Contract drift needs fix, not retry

    case 'validation':
      return false; // Invalid input won't fix on retry

    case 'rate_limit':
      return true; // Rate limits clear over time

    case 'network':
      return true; // Network issues often transient

    case 'stream':
      return true; // Stream reconnect is safe

    case 'decision_engine':
      return true; // AI orchestration can be retried

    case 'execution':
      return false; // Action execution retry needs idempotency check

    case 'workspace':
      return false; // Workspace errors usually need investigation

    case 'platform':
      return true; // External platform errors may clear

    default:
      return false; // Safe default: don't retry unless explicitly allowed
  }
}
