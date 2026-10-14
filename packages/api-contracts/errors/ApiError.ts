/**
 * ApiError — HTTP/Network request failures
 *
 * Thrown when API requests fail due to network issues,
 * HTTP errors, or backend failures.
 *
 * @example
 * ```ts
 * try {
 *   const response = await api.get('/api/lumi/feed');
 * } catch (err) {
 *   throw new ApiError({
 *     message: 'Failed to fetch Lumi feed',
 *     endpoint: '/api/lumi/feed',
 *     method: 'GET',
 *     httpStatus: err.response?.status,
 *     cause: err,
 *   });
 * }
 * ```
 */

import { AppError, type ErrorConfig, type ErrorClassification } from './AppError';

/**
 * API error configuration
 */
export interface ApiErrorConfig extends Omit<ErrorConfig, 'classification'> {
  /** API endpoint */
  endpoint: string;

  /** HTTP method */
  method?: string;

  /** Request payload (for debugging) */
  requestPayload?: unknown;

  /** Response data (if available) */
  responseData?: unknown;

  /** Backend error code (if provided) */
  errorCode?: string;
}

/**
 * Error thrown when API requests fail
 *
 * Classification is auto-determined from HTTP status:
 * - 401/403 → 'auth'
 * - Network errors → 'network'
 * - 400/422 → 'validation'
 * - Other → 'platform'
 */
export class ApiError extends AppError {
  /** API endpoint */
  readonly endpoint: string;

  /** HTTP method */
  readonly method?: string;

  /** Request payload (sanitized) */
  readonly requestPayload?: unknown;

  /** Response data */
  readonly responseData?: unknown;

  /** Backend error code */
  readonly errorCode?: string;

  constructor(config: ApiErrorConfig) {
    const classification = classifyApiError(config.httpStatus);

    super({
      ...config,
      classification,
      retryable: config.retryable ?? isRetryable(config.httpStatus),
      context: {
        ...config.context,
        endpoint: config.endpoint,
        method: config.method,
        errorCode: config.errorCode,
      },
    });

    this.endpoint = config.endpoint;
    this.method = config.method;
    this.requestPayload = config.requestPayload;
    this.responseData = config.responseData;
    this.errorCode = config.errorCode;
  }

  /**
   * Extended JSON serialization with API details
   */
  toJSON() {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      method: this.method,
      errorCode: this.errorCode,
      // Omit payloads from logs (could contain sensitive data)
    };
  }
}

/**
 * Classify error based on HTTP status code
 */
function classifyApiError(status?: number): ErrorClassification {
  if (!status) return 'network';

  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'platform';
  if (status >= 400) return 'validation';

  return 'network';
}

/**
 * Determine if error is retryable based on HTTP status
 */
function isRetryable(status?: number): boolean {
  if (!status) return true; // Network errors are retryable

  // Retry server errors and rate limits
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true; // Request timeout

  // Don't retry client errors (except 408, 429)
  return false;
}
