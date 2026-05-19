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
 * Error classification types
 *
 * - auth: Authentication/authorization failures
 * - network: Connection/timeout errors
 * - platform: External platform errors (Meta API, etc.)
 * - validation: Invalid request data
 * - parsing: Invalid response format (contract drift)
 */
export type ErrorClassification =
  | 'auth'
  | 'network'
  | 'platform'
  | 'validation'
  | 'parsing';

/**
 * Error configuration for AppError constructor
 */
export interface ErrorConfig {
  /** Human-readable error message */
  message: string;

  /** Error classification for routing and telemetry */
  classification: ErrorClassification;

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
    this.retryable = config.retryable ?? true;
    this.fallbackAction = config.fallbackAction;
    this.httpStatus = config.httpStatus;
    this.cause = config.cause;
    this.context = config.context;
    this.timestamp = new Date();
  }

  /**
   * Convert error to JSON for logging/telemetry
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      classification: this.classification,
      retryable: this.retryable,
      fallbackAction: this.fallbackAction,
      httpStatus: this.httpStatus,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * User-friendly error summary
   */
  toString(): string {
    return `[${this.classification.toUpperCase()}] ${this.message}`;
  }
}
