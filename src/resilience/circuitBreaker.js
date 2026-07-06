// ============================================================
// Generic Circuit Breaker (Phase 11B)
// ------------------------------------------------------------
// Prevents cascading failures by short-circuiting calls to
// degraded services.
//
// States:
//   CLOSED → Normal operation, all calls pass through
//   OPEN   → Service degraded, all calls fail fast
//   HALF_OPEN → Testing recovery, limited calls pass through
//
// Flow:
//   CLOSED → (failures >= threshold) → OPEN
//   OPEN   → (timeout expires) → HALF_OPEN
//   HALF_OPEN → (success) → CLOSED
//   HALF_OPEN → (failure) → OPEN
//
// Architecture:
// - Failure tracking with sliding window
// - Automatic state transitions
// - Configurable thresholds and timeouts
// - Telemetry integration (Phase 10D)
// ============================================================
import { logger } from '../utils/logger.js';

/** @typedef {'CLOSED'|'OPEN'|'HALF_OPEN'} CircuitState */

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {string} name - Circuit identifier (for telemetry)
 * @property {number} failureThreshold - Failures before opening (default: 5)
 * @property {number} successThreshold - Successes in HALF_OPEN to close (default: 2)
 * @property {number} timeout - Milliseconds before HALF_OPEN (default: 60000)
 * @property {number} volumeThreshold - Minimum calls before evaluating (default: 10)
 * @property {Function} [onStateChange] - Callback(state, metrics)
 */

/**
 * Generic Circuit Breaker
 *
 * Wraps async functions with failure detection and automatic
 * short-circuiting.
 *
 * @example
 * ```js
 * const breaker = new CircuitBreaker({
 *   name: 'orchestrator',
 *   failureThreshold: 3,
 *   timeout: 60_000,
 * });
 *
 * const result = await breaker.execute(async () => {
 *   return await callOrchestrator();
 * });
 *
 * if (!result.success) {
 *   logger.error({ err: result.error }, 'Circuit open');
 * }
 * ```
 */
export class CircuitBreaker {
  /**
   * @param {CircuitBreakerOptions} options
   */
  constructor(options) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60_000;
    this.volumeThreshold = options.volumeThreshold ?? 10;
    this.onStateChange = options.onStateChange;

    /** @type {CircuitState} */
    this.state = 'CLOSED';

    // Metrics
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
    this.totalCalls = 0;
    this.lastFailureTime = null;
    this.openedAt = null;
    this.lastStateChange = Date.now();

    // Half-open state tracking
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
  }

  /**
   * Execute function with circuit breaker protection
   *
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @returns {Promise<{success: boolean, data?: T, error?: Error, circuitState: CircuitState}>}
   */
  async execute(fn) {
    // Check if circuit should transition from OPEN → HALF_OPEN
    if (this.state === 'OPEN' && this._shouldAttemptReset()) {
      this._transitionTo('HALF_OPEN');
    }

    // Fast-fail if circuit open
    if (this.state === 'OPEN') {
      logger.debug(
        { name: this.name, state: this.state },
        '[CircuitBreaker] Circuit OPEN — fast-fail'
      );

      return {
        success: false,
        error: new Error(`Circuit breaker OPEN for ${this.name}`),
        circuitState: this.state,
      };
    }

    // Execute function and track result
    this.totalCalls++;

    try {
      const data = await fn();

      // Success
      this._recordSuccess();

      return {
        success: true,
        data,
        circuitState: this.state,
      };
    } catch (error) {
      // Failure
      this._recordFailure(error);

      return {
        success: false,
        error,
        circuitState: this.state,
      };
    }
  }

  /**
   * Get current circuit state
   *
   * @returns {CircuitState}
   */
  getState() {
    return this.state;
  }

  /**
   * Get circuit metrics
   *
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      lastFailureTime: this.lastFailureTime,
      openedAt: this.openedAt,
      downtime: this.openedAt ? Date.now() - this.openedAt : 0,
    };
  }

  /**
   * Force circuit to OPEN (for testing or manual intervention)
   */
  forceOpen() {
    this._transitionTo('OPEN');
  }

  /**
   * Force circuit to CLOSED (manual recovery)
   */
  forceClose() {
    this._reset();
    this._transitionTo('CLOSED');
  }

  /**
   * Reset metrics (clear history)
   */
  reset() {
    this._reset();
  }

  // ════════════════════════════════════════════════════════════
  // Internal Methods
  // ════════════════════════════════════════════════════════════

  /**
   * Record successful call
   * @private
   */
  _recordSuccess() {
    this.successCount++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;

      // Close circuit after threshold successes
      if (this.halfOpenSuccesses >= this.successThreshold) {
        logger.info(
          {
            name: this.name,
            halfOpenSuccesses: this.halfOpenSuccesses,
            threshold: this.successThreshold,
          },
          '[CircuitBreaker] Recovery confirmed — closing circuit'
        );
        this._reset();
        this._transitionTo('CLOSED');
      }
    }
  }

  /**
   * Record failed call
   * @private
   */
  _recordFailure(error) {
    this.failureCount++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    logger.warn(
      {
        name: this.name,
        state: this.state,
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.failureThreshold,
        error: error.message,
      },
      '[CircuitBreaker] Call failed'
    );

    // Transition logic
    if (this.state === 'HALF_OPEN') {
      // Half-open test failed → reopen circuit
      logger.warn({ name: this.name }, '[CircuitBreaker] Half-open test failed — reopening');
      this._transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      // Check if should open circuit
      if (
        this.consecutiveFailures >= this.failureThreshold &&
        this.totalCalls >= this.volumeThreshold
      ) {
        logger.error(
          {
            name: this.name,
            consecutiveFailures: this.consecutiveFailures,
            threshold: this.failureThreshold,
          },
          '[CircuitBreaker] Failure threshold exceeded — opening circuit'
        );
        this._transitionTo('OPEN');
      }
    }
  }

  /**
   * Check if circuit should transition from OPEN → HALF_OPEN
   * @private
   */
  _shouldAttemptReset() {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt >= this.timeout;
  }

  /**
   * Transition to new state
   * @private
   * @param {CircuitState} newState
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    // State-specific logic
    if (newState === 'OPEN') {
      this.openedAt = Date.now();
    } else if (newState === 'HALF_OPEN') {
      this.halfOpenAttempts = 0;
      this.halfOpenSuccesses = 0;
    } else if (newState === 'CLOSED') {
      this.openedAt = null;
    }

    logger.info(
      { name: this.name, oldState, newState, metrics: this.getMetrics() },
      '[CircuitBreaker] State transition'
    );

    // Callback
    if (this.onStateChange) {
      try {
        this.onStateChange(newState, this.getMetrics());
      } catch (err) {
        logger.error({ err: err.message }, '[CircuitBreaker] onStateChange callback failed');
      }
    }
  }

  /**
   * Reset metrics
   * @private
   */
  _reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.totalCalls = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
  }
}

/**
 * Create a circuit breaker with telemetry integration
 *
 * @param {CircuitBreakerOptions} options
 * @returns {CircuitBreaker}
 */
export function createCircuitBreaker(options) {
  return new CircuitBreaker(options);
}
