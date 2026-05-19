/**
 * Error Classes — Typed error hierarchy for MARCOM
 *
 * Provides structured error handling across the application:
 * - AppError: Base class with classification and retry logic
 * - ParsingError: Contract validation failures (schema drift)
 * - ApiError: HTTP/network request failures
 *
 * @example
 * ```ts
 * import { ParsingError, ApiError } from '@/contracts/errors';
 *
 * // Parsing error
 * throw new ParsingError({
 *   message: 'Invalid response',
 *   schema: 'LumiFeedResponseSchema',
 *   issues: result.error.issues,
 * });
 *
 * // API error
 * throw new ApiError({
 *   message: 'Failed to fetch feed',
 *   endpoint: '/api/lumi/feed',
 *   httpStatus: 500,
 * });
 * ```
 */

export { AppError, type ErrorConfig, type ErrorClassification } from './AppError';
export { ParsingError, type ParsingErrorConfig } from './ParsingError';
export { ApiError, type ApiErrorConfig } from './ApiError';
