/**
 * Correlation ID Utilities (Phase 10D)
 *
 * Generates and manages correlation IDs for distributed tracing.
 * Essential for debugging orchestration chains, retries, and failures.
 *
 * @example
 * ```ts
 * import { generateRequestId, getSessionId } from '@/lib/correlation';
 *
 * // Each API request gets unique ID
 * const requestId = generateRequestId();
 *
 * // Session persists across page reloads
 * const sessionId = getSessionId();
 * ```
 */

/**
 * Session ID key in sessionStorage
 */
const SESSION_ID_KEY = 'marcom_session_id';

/**
 * Generate unique request ID
 *
 * Format: req_<timestamp>_<random>
 * Example: req_1705847293847_a3f9c2
 *
 * @returns Unique request ID
 */
export function generateRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

/**
 * Get or create session ID
 *
 * Session ID persists across page reloads via sessionStorage.
 * Cleared when browser tab closes.
 *
 * Format: ses_<timestamp>_<random>
 * Example: ses_1705847293847_x9d4e1
 *
 * @returns Session ID
 */
export function getSessionId(): string {
  // Check sessionStorage for existing ID
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const existingId = sessionStorage.getItem(SESSION_ID_KEY);
    if (existingId) {
      return existingId;
    }

    // Generate new session ID
    const sessionId = `sess_${crypto.randomUUID()}`;

    // Persist to sessionStorage
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    return sessionId;
  }

  // Fallback for SSR or missing sessionStorage
  return `ses_${Date.now()}_fallback`;
}

/**
 * Clear session ID
 *
 * Useful for logout or session reset.
 */
export function clearSessionId(): void {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    sessionStorage.removeItem(SESSION_ID_KEY);
  }
}

/**
 * Get correlation context
 *
 * Returns both request and session IDs for logging/telemetry.
 *
 * @returns Correlation context object
 */
export function getCorrelationContext(): {
  requestId: string;
  sessionId: string;
} {
  return {
    requestId: generateRequestId(),
    sessionId: getSessionId(),
  };
}
