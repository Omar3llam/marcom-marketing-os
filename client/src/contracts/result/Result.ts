/**
 * Result Pattern — Enterprise-grade error handling
 *
 * Replaces exception-driven architecture with explicit success/failure states.
 *
 * Benefits:
 * - Easier telemetry tracking
 * - Explicit retry logic
 * - Better Suspense integration
 * - Optimistic UI support
 * - Testable error paths
 * - No uncaught exceptions
 *
 * @example
 * ```ts
 * const result = parseLumiFeed(payload);
 * if (!result.success) {
 *   track('parsing_error', { error: result.error });
 *   return <ErrorView error={result.error} />;
 * }
 * return <FeedDisplay data={result.data} />;
 * ```
 */

import type { AppError } from '../errors';

/**
 * Success case — operation completed successfully
 */
export interface Success<T> {
  success: true;
  data: T;
}

/**
 * Failure case — operation failed with typed error
 */
export interface Failure {
  success: false;
  error: AppError;
}

/**
 * Result type — discriminated union of Success and Failure
 */
export type Result<T> = Success<T> | Failure;

/**
 * Type guard — check if result is success
 */
export function isSuccess<T>(result: Result<T>): result is Success<T> {
  return result.success === true;
}

/**
 * Type guard — check if result is failure
 */
export function isFailure<T>(result: Result<T>): result is Failure {
  return result.success === false;
}

/**
 * Helper — create success result
 */
export function success<T>(data: T): Success<T> {
  return { success: true, data };
}

/**
 * Helper — create failure result
 */
export function failure(error: AppError): Failure {
  return { success: false, error };
}

/**
 * Helper — unwrap result or throw if failure
 *
 * Use sparingly — only when you're certain the operation succeeded
 * or when you want to propagate the error up the call stack.
 */
export function unwrap<T>(result: Result<T>): T {
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * Helper — map success value to new type
 *
 * @example
 * ```ts
 * const result = parseLumiFeed(payload);
 * const mapped = mapResult(result, (data) => data.campaigns);
 * ```
 */
export function mapResult<T, U>(
  result: Result<T>,
  fn: (data: T) => U
): Result<U> {
  if (!result.success) {
    return result;
  }
  return success(fn(result.data));
}

/**
 * Helper — chain results (flatMap)
 *
 * @example
 * ```ts
 * const result = parseLumiFeed(payload);
 * const chained = chainResult(result, (data) => validateCampaigns(data.campaigns));
 * ```
 */
export function chainResult<T, U>(
  result: Result<T>,
  fn: (data: T) => Result<U>
): Result<U> {
  if (!result.success) {
    return result;
  }
  return fn(result.data);
}
