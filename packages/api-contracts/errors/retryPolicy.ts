/**
 * Retry Intelligence Matrix (Phase 10)
 *
 * Codifies retry behavior centrally to prevent retry logic
 * from spreading like ivy through hooks/components.
 *
 * NOT all errors deserve retries. Some (AuthError, ContractError)
 * need human intervention, not automated retry.
 *
 * @example
 * ```ts
 * import { getRetryStrategy, executeWithRetry } from '@/contracts/errors';
 *
 * try {
 *   await fetchFeed();
 * } catch (error) {
 *   const strategy = getRetryStrategy(error);
 *   if (strategy) {
 *     await executeWithRetry(() => fetchFeed(), strategy);
 *   }
 * }
 * ```
 */

import type { AppError } from './AppError';
import {
  RateLimitError,
  StreamDisconnectError,
  NetworkError,
  DecisionEngineError,
  PlatformError,
  ContractSyncError,
} from './DomainErrors';

/**
 * Retry strategy types
 */
export type RetryStrategyType =
  | 'exponential_backoff'
  | 'linear_reconnect'
  | 'fixed_interval'
  | 'no_retry';

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  /** Strategy type */
  type: RetryStrategyType;

  /** Maximum retry attempts */
  maxAttempts: number;

  /** Base delay in milliseconds */
  baseDelay: number;

  /** Maximum delay cap in milliseconds */
  maxDelay?: number;

  /** Backoff multiplier (for exponential) */
  multiplier?: number;

  /** Jitter factor (0-1) to randomize delays */
  jitter?: number;
}

/**
 * Exponential backoff strategy
 *
 * Delays grow exponentially: baseDelay * multiplier^attempt
 * Good for: Rate limits, platform API errors
 *
 * Example: 1s → 2s → 4s → 8s → 16s (capped at maxDelay)
 */
export const EXPONENTIAL_BACKOFF: RetryStrategy = {
  type: 'exponential_backoff',
  maxAttempts: 5,
  baseDelay: 1000, // 1s
  maxDelay: 32000, // 32s cap
  multiplier: 2,
  jitter: 0.1, // 10% randomization
};

/**
 * Linear reconnect strategy
 *
 * Delays stay constant: baseDelay every attempt
 * Good for: Stream reconnects, network recovery
 *
 * Example: 2s → 2s → 2s → 2s → 2s
 */
export const LINEAR_RECONNECT: RetryStrategy = {
  type: 'linear_reconnect',
  maxAttempts: 10,
  baseDelay: 2000, // 2s
  jitter: 0.05, // 5% randomization
};

/**
 * Fixed interval strategy
 *
 * Delays are fixed: baseDelay every attempt
 * Good for: Network timeouts, transient errors
 *
 * Example: 3s → 3s → 3s
 */
export const FIXED_INTERVAL: RetryStrategy = {
  type: 'fixed_interval',
  maxAttempts: 3,
  baseDelay: 3000, // 3s
};

/**
 * No retry strategy
 *
 * Error is not retryable, fail immediately
 * Good for: Auth failures, validation errors, contract drift
 */
export const NO_RETRY: RetryStrategy = {
  type: 'no_retry',
  maxAttempts: 0,
  baseDelay: 0,
};

/**
 * Retry Policy Registry
 *
 * Maps error classes to retry strategies.
 * Consulted before any retry attempt.
 *
 * Order matters: more specific classes first.
 */
export const RETRY_POLICY: Record<string, RetryStrategy> = {
  // High-priority retryable errors
  RateLimitError: EXPONENTIAL_BACKOFF,
  StreamDisconnectError: LINEAR_RECONNECT,
  NetworkError: FIXED_INTERVAL,

  // Conditional retries
  DecisionEngineError: FIXED_INTERVAL, // AI may recover
  PlatformError: EXPONENTIAL_BACKOFF, // External APIs may clear
  ContractSyncError: FIXED_INTERVAL, // Backend may recover

  // Everything else: check error.retryable flag
  // If not in registry, fall back to NO_RETRY unless explicitly retryable
};

/**
 * Get retry strategy for an error
 *
 * Consults RETRY_POLICY registry, falls back to error.retryable flag.
 *
 * @param error - Error to check
 * @returns Retry strategy or null if not retryable
 */
export function getRetryStrategy(error: AppError): RetryStrategy | null {
  // Check registry first
  const errorClassName = error.constructor.name;
  if (errorClassName in RETRY_POLICY) {
    return RETRY_POLICY[errorClassName];
  }

  // Fallback to error.retryable flag
  if (error.retryable) {
    return FIXED_INTERVAL; // Safe default
  }

  return null; // Not retryable
}

/**
 * Calculate delay for retry attempt
 *
 * Applies strategy-specific delay calculation with jitter.
 *
 * @param strategy - Retry strategy
 * @param attempt - Current attempt number (0-based)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(
  strategy: RetryStrategy,
  attempt: number
): number {
  let delay: number;

  switch (strategy.type) {
    case 'exponential_backoff':
      delay = strategy.baseDelay * Math.pow(strategy.multiplier || 2, attempt);
      if (strategy.maxDelay) {
        delay = Math.min(delay, strategy.maxDelay);
      }
      break;

    case 'linear_reconnect':
    case 'fixed_interval':
      delay = strategy.baseDelay;
      break;

    case 'no_retry':
    default:
      return 0;
  }

  // Apply jitter to avoid thundering herd
  if (strategy.jitter && strategy.jitter > 0) {
    const jitterAmount = delay * strategy.jitter;
    const jitterOffset = Math.random() * jitterAmount * 2 - jitterAmount;
    delay += jitterOffset;
  }

  return Math.floor(delay);
}

/**
 * Execute function with retry strategy
 *
 * Retries a function according to the strategy, with proper delays.
 *
 * @param fn - Async function to execute
 * @param strategy - Retry strategy
 * @param onRetry - Optional callback on retry attempt
 * @returns Result of function
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  strategy: RetryStrategy,
  onRetry?: (attempt: number, delay: number) => void
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= strategy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // If this was the last attempt, don't retry
      if (attempt >= strategy.maxAttempts) {
        break;
      }

      // Calculate delay and wait
      const delay = calculateRetryDelay(strategy, attempt);
      if (onRetry) {
        onRetry(attempt + 1, delay);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  throw lastError || new Error('Retry failed');
}

/**
 * Check if error should be retried
 *
 * Quick check for retry eligibility.
 *
 * @param error - Error to check
 * @returns True if error should be retried
 */
export function shouldRetry(error: AppError): boolean {
  return getRetryStrategy(error) !== null;
}
