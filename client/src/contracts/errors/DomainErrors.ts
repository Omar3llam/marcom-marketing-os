/**
 * Domain Error Taxonomy (Phase 10)
 *
 * Domain-centric errors for observable failure intelligence.
 * Each error type has sensible defaults for severity, retryability,
 * and UX behavior.
 *
 * DO NOT create transport-centric errors like "FetchError" or "500Error".
 * Map transport failures INTO these domain errors instead.
 *
 * @example
 * ```ts
 * // ❌ BAD: Transport-centric
 * throw new Error('Fetch failed');
 *
 * // ✅ GOOD: Domain-centric
 * throw new StreamDisconnectError({
 *   message: 'SSE stream disconnected',
 *   context: { endpoint: '/api/lumi/stream' },
 * });
 * ```
 */

import { AppError, type ErrorConfig } from './AppError';

/**
 * AuthError — Authentication/authorization failures
 *
 * Severity: HIGH (blocks usage)
 * Retryable: NO (requires re-login)
 * UX: Redirect to login
 *
 * @example
 * ```ts
 * throw new AuthError({
 *   message: 'Session expired',
 *   code: 'AUTH_SESSION_EXPIRED',
 *   fallbackAction: 'Please log in again',
 * });
 * ```
 */
export class AuthError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'auth',
      severity: config.severity || 'high',
      retryable: config.retryable ?? false,
    });
  }
}

/**
 * RateLimitError — Quota/throttling errors
 *
 * Severity: MEDIUM (recoverable)
 * Retryable: YES (exponential backoff)
 * UX: Toast with retry countdown
 *
 * @example
 * ```ts
 * throw new RateLimitError({
 *   message: 'API rate limit exceeded',
 *   code: 'RATE_LIMIT_EXCEEDED',
 *   context: { retryAfter: 60 },
 *   fallbackAction: 'Please wait 60 seconds before retrying',
 * });
 * ```
 */
export class RateLimitError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'rate_limit',
      severity: config.severity || 'medium',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * DecisionEngineError — AI orchestration failures
 *
 * Severity: HIGH (degrades core function)
 * Retryable: YES (AI may recover)
 * UX: Panel failure with degraded mode option
 *
 * @example
 * ```ts
 * throw new DecisionEngineError({
 *   message: 'Lumi orchestration failed during campaign analysis',
 *   code: 'DECISION_ENGINE_ORCHESTRATION_FAILED',
 *   context: { agentType: 'claude', attemptCount: 2 },
 *   fallbackAction: 'Try again or use manual analysis mode',
 * });
 * ```
 */
export class DecisionEngineError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'decision_engine',
      severity: config.severity || 'high',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * WorkspaceError — Workspace/tenant errors
 *
 * Severity: MEDIUM (may allow partial render)
 * Retryable: NO (needs investigation)
 * UX: Inline warning with partial data
 *
 * @example
 * ```ts
 * throw new WorkspaceError({
 *   message: 'Workspace access denied',
 *   code: 'WORKSPACE_ACCESS_DENIED',
 *   context: { workspaceId: 'wks_test_001' },
 *   fallbackAction: 'Contact workspace admin for access',
 * });
 * ```
 */
export class WorkspaceError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'workspace',
      severity: config.severity || 'medium',
      retryable: config.retryable ?? false,
    });
  }
}

/**
 * ContractSyncError — Contract/feed synchronization failures
 *
 * Severity: HIGH (data integrity)
 * Retryable: YES (backend may recover)
 * UX: Panel failure with refresh action
 *
 * @example
 * ```ts
 * throw new ContractSyncError({
 *   message: 'Failed to sync campaign feed',
 *   code: 'CONTRACT_SYNC_FAILED',
 *   context: { endpoint: '/api/lumi/feed' },
 *   fallbackAction: 'Refresh the page or try again',
 * });
 * ```
 */
export class ContractSyncError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'contract',
      severity: config.severity || 'high',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * StreamDisconnectError — SSE/WebSocket disconnect
 *
 * Severity: MEDIUM (stream recoverable)
 * Retryable: YES (linear reconnect)
 * UX: Toast notification during reconnect
 *
 * @example
 * ```ts
 * throw new StreamDisconnectError({
 *   message: 'SSE stream disconnected',
 *   code: 'STREAM_DISCONNECTED',
 *   context: { endpoint: '/api/lumi/stream', reconnectAttempt: 1 },
 *   fallbackAction: 'Reconnecting...',
 * });
 * ```
 */
export class StreamDisconnectError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'stream',
      severity: config.severity || 'medium',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * ExecutionError — Action execution failures
 *
 * Severity: HIGH (user action failed)
 * Retryable: NO (requires idempotency check)
 * UX: Panel failure with clear reason
 *
 * @example
 * ```ts
 * throw new ExecutionError({
 *   message: 'Failed to pause campaign',
 *   code: 'EXECUTION_META_API_FAILED',
 *   context: { actionId: 'act_test_001', platform: 'meta' },
 *   fallbackAction: 'Check Meta Ads Manager or try again',
 * });
 * ```
 */
export class ExecutionError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'execution',
      severity: config.severity || 'high',
      retryable: config.retryable ?? false,
    });
  }
}

/**
 * NetworkError — Connection/timeout errors
 *
 * Severity: MEDIUM (often transient)
 * Retryable: YES (network may recover)
 * UX: Toast with auto-retry
 *
 * @example
 * ```ts
 * throw new NetworkError({
 *   message: 'Request timeout after 30s',
 *   code: 'NETWORK_TIMEOUT',
 *   context: { endpoint: '/api/lumi/feed', timeout: 30000 },
 *   fallbackAction: 'Check your connection and try again',
 * });
 * ```
 */
export class NetworkError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'network',
      severity: config.severity || 'medium',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * PlatformError — External platform API errors (Meta, Google, etc.)
 *
 * Severity: HIGH (blocks features)
 * Retryable: YES (platform may recover)
 * UX: Panel failure with platform-specific guidance
 *
 * @example
 * ```ts
 * throw new PlatformError({
 *   message: 'Meta API rate limit exceeded',
 *   code: 'PLATFORM_META_RATE_LIMIT',
 *   context: { platform: 'meta', retryAfter: 3600 },
 *   fallbackAction: 'Meta API is rate-limited. Try again in 1 hour.',
 * });
 * ```
 */
export class PlatformError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'platform',
      severity: config.severity || 'high',
      retryable: config.retryable ?? true,
    });
  }
}

/**
 * ValidationError — Invalid request data (user input)
 *
 * Severity: LOW (user-correctable)
 * Retryable: NO (needs input fix)
 * UX: Inline error on form field
 *
 * @example
 * ```ts
 * throw new ValidationError({
 *   message: 'Campaign ID is required',
 *   code: 'VALIDATION_REQUIRED_FIELD',
 *   context: { field: 'campaign_id' },
 *   fallbackAction: 'Please enter a campaign ID',
 * });
 * ```
 */
export class ValidationError extends AppError {
  constructor(config: Omit<ErrorConfig, 'classification'>) {
    super({
      ...config,
      classification: 'validation',
      severity: config.severity || 'low',
      retryable: config.retryable ?? false,
    });
  }
}
