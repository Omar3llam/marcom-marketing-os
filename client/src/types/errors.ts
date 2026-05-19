// ============================================================
// MARCOM v4.1 — Error Classification Types
// ------------------------------------------------------------
// TypeScript definitions for error handling and classification.
// Based on: BACKEND-CONTRACTS.md § Error Contracts
//
// FROZEN: These types match backend error contracts.
// Do NOT modify without updating BACKEND-CONTRACTS.md first.
// ============================================================

/**
 * Error classification taxonomy.
 * Determines retry strategy and user messaging.
 */
export type ErrorClassification =
  | 'auth'       // Firebase/OAuth token issues → refresh or reconnect
  | 'network'    // Timeout, connection refused → retry
  | 'platform'   // Meta API rejected request → check permissions
  | 'validation' // Bad request body → fix input and retry
  | 'parsing';   // CSV parse failure → check format

/**
 * Standard API error shape (all errors follow this contract).
 */
export interface APIError {
  error: string;                       // Human-readable error message
  code?: string;                       // Machine-readable error code
  hint?: string;                       // Optional hint for resolution
  classification?: ErrorClassification;
  retryable?: boolean;                 // Can the request be retried?
  fallbackAction?: string;             // Suggested fallback for user
}

/**
 * Error codes used across the API.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'           // 401: Firebase token missing/invalid
  | 'VALIDATION_ERROR'          // 400: Request body validation failed
  | 'META_API_ERROR'            // 400: Meta API rejected request
  | 'CREDENTIAL_NOT_FOUND'      // 404: No OAuth credential for project
  | 'TOKEN_EXPIRED'             // 401: Meta OAuth token expired
  | 'ROLLBACK_WINDOW_EXPIRED'   // 410: Action >24h old, cannot rollback
  | 'INTERNAL_ERROR';           // 500: Server error

/**
 * FSM-specific error details (extends APIError).
 */
export interface FSMErrorDetails {
  message: string;
  code: string;
  classification: ErrorClassification;
  retryable: boolean;
  fallbackAction: string;
}

/**
 * Request state lifecycle.
 */
export type RequestState =
  | 'idle'      // No request in flight
  | 'loading'   // Request sent, awaiting response
  | 'success'   // Response received (2xx)
  | 'error'     // Response received (4xx/5xx) or network error
  | 'stale';    // Success but data may be outdated (polling use case)

/**
 * Retry strategy configuration.
 */
export interface RetryConfig {
  maxAttempts: number;
  delayMs: number[];
  shouldRetry: (error: APIError) => boolean;
}
