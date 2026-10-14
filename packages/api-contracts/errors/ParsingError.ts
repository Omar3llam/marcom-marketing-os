/**
 * ParsingError — Contract validation failures
 *
 * Thrown when backend responses don't match expected schemas.
 * Indicates contract drift between frontend and backend.
 *
 * @example
 * ```ts
 * const result = LumiFeedResponseSchema.safeParse(payload);
 * if (!result.success) {
 *   throw new ParsingError({
 *     message: 'Invalid Lumi feed response',
 *     issues: result.error.issues,
 *     endpoint: '/api/lumi/feed',
 *     schema: 'LumiFeedResponseSchema',
 *   });
 * }
 * ```
 */

import { AppError, type ErrorConfig } from './AppError';
import type { ZodIssue } from 'zod';

/**
 * Parsing error configuration
 */
export interface ParsingErrorConfig extends Omit<ErrorConfig, 'classification'> {
  /** Zod validation issues */
  issues?: ZodIssue[];

  /** API endpoint that returned invalid data */
  endpoint?: string;

  /** Schema name that failed validation */
  schema?: string;

  /** Actual payload that failed (for debugging) */
  payload?: unknown;
}

/**
 * Error thrown when response parsing fails
 *
 * Always classified as 'parsing' and generally not retryable
 * (unless it's a transient network corruption issue).
 */
export class ParsingError extends AppError {
  /** Zod validation issues */
  readonly issues?: ZodIssue[];

  /** API endpoint */
  readonly endpoint?: string;

  /** Schema name */
  readonly schema?: string;

  /** Failed payload (sanitized for logging) */
  readonly payload?: unknown;

  constructor(config: ParsingErrorConfig) {
    super({
      ...config,
      classification: 'parsing',
      retryable: config.retryable ?? false, // Parsing errors usually not retryable
      context: {
        ...config.context,
        endpoint: config.endpoint,
        schema: config.schema,
        issueCount: config.issues?.length,
      },
    });

    this.issues = config.issues;
    this.endpoint = config.endpoint;
    this.schema = config.schema;
    this.payload = config.payload;
  }

  /**
   * Format Zod issues for user-friendly display
   */
  formatIssues(): string[] {
    if (!this.issues) return [];

    return this.issues.map((issue) => {
      const path = issue.path.join('.');
      return `${path}: ${issue.message}`;
    });
  }

  /**
   * Extended JSON serialization with parsing details
   */
  toJSON() {
    return {
      ...super.toJSON(),
      issues: this.formatIssues(),
      endpoint: this.endpoint,
      schema: this.schema,
      // Omit payload from logs (could be huge)
    };
  }
}
