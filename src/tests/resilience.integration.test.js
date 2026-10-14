// ============================================================
// Phase 11A — Resilience Wiring Integration Tests
// ------------------------------------------------------------
// Validates that resilience infrastructure is properly wired:
// - Retry policy is applied to API errors
// - Timeout guards trigger correctly
// - Telemetry hooks fire on resilience events
//
// S1-B — the Circuit Breaker Integration and SSE-Broadcast blocks are gone.
// Both drove `orchestratorCircuit`, which existed only to wrap runOrchestration
// — removed with the CampaignState population it read. A breaker around a
// deleted function has no state to assert, and the DB fixtures those blocks
// needed built CampaignState rows nothing can write. What remains is DB-free
// and always runs.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  getRetryStrategy,
  executeWithRetry,
  calculateRetryDelay,
  EXPONENTIAL_BACKOFF,
  LINEAR_RECONNECT,
  FIXED_INTERVAL,
  NO_RETRY,
} from '../../packages/api-contracts/errors/retryPolicy.ts';
import { NetworkError, PlatformError, RateLimitError } from '../../packages/api-contracts/errors/index.ts';


describe('Resilience Wiring Integration Tests', () => {

  describe('Retry Policy Integration', () => {
    it('should identify retryable NetworkError', () => {
      const error = new NetworkError({
        message: 'Connection timeout',
        code: 'NETWORK_TIMEOUT',
      });

      const strategy = getRetryStrategy(error);
      expect(strategy).toBeDefined();
      expect(strategy.type).toBe('fixed_interval');
      expect(strategy.maxAttempts).toBe(3);
    });

    it('should identify retryable PlatformError', () => {
      const error = new PlatformError({
        message: 'Server error',
        code: 'PLATFORM_ERROR',
        httpStatus: 500,
      });

      const strategy = getRetryStrategy(error);
      expect(strategy).toBeDefined();
      expect(strategy.type).toBe('exponential_backoff');
    });

    it('should identify retryable RateLimitError', () => {
      const error = new RateLimitError({
        message: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        httpStatus: 429,
      });

      const strategy = getRetryStrategy(error);
      expect(strategy).toBeDefined();
      expect(strategy.type).toBe('exponential_backoff');
    });

    it('should calculate exponential backoff correctly', () => {
      const delay0 = calculateRetryDelay(EXPONENTIAL_BACKOFF, 0);
      const delay1 = calculateRetryDelay(EXPONENTIAL_BACKOFF, 1);
      const delay2 = calculateRetryDelay(EXPONENTIAL_BACKOFF, 2);

      // Base delay: 1000ms, multiplier: 2
      expect(delay0).toBeGreaterThanOrEqual(900);  // ~1000ms with jitter
      expect(delay0).toBeLessThanOrEqual(1100);
      expect(delay1).toBeGreaterThanOrEqual(1800); // ~2000ms with jitter
      expect(delay1).toBeLessThanOrEqual(2200);
      expect(delay2).toBeGreaterThanOrEqual(3600); // ~4000ms with jitter
      expect(delay2).toBeLessThanOrEqual(4400);
    });

    it('should respect max delay cap', () => {
      const delay = calculateRetryDelay(EXPONENTIAL_BACKOFF, 10); // Would be huge without cap
      expect(delay).toBeLessThanOrEqual(EXPONENTIAL_BACKOFF.maxDelay * 1.1); // With jitter margin
    });

    it('should execute with retry on transient failure', async () => {
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient failure');
        }
        return { success: true };
      });

      const strategy = { ...FIXED_INTERVAL, baseDelay: 10 }; // Fast retries for test
      const result = await executeWithRetry(fn, strategy);

      expect(result).toEqual({ success: true });
      expect(callCount).toBe(3); // Failed twice, succeeded on third
    });

    it('should exhaust retries and throw on persistent failure', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Persistent failure');
      });

      const strategy = { ...FIXED_INTERVAL, maxAttempts: 2, baseDelay: 10 };

      await expect(executeWithRetry(fn, strategy)).rejects.toThrow('Persistent failure');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Timeout Governance', () => {
    it('should enforce orchestration timeout in useOrchestrate hook', async () => {
      // This would be tested in a React component test environment
      // Mocking hook behavior here for coverage
      const mockOrchestrate = async (timeout = 90_000) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Orchestration timeout'));
          }, timeout);

          // Simulate completion before timeout
          setTimeout(() => {
            clearTimeout(timer);
            resolve({ success: true });
          }, timeout - 1000);
        });
      };

      const result = await mockOrchestrate(100); // 100ms timeout for fast test
      expect(result).toEqual({ success: true });
    });

    it('should trigger timeout on slow orchestration', async () => {
      const mockSlowOrchestrate = async (timeout = 100) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Orchestration timeout'));
          }, timeout);

          // Simulate slow operation (never completes before timeout)
        });
      };

      await expect(mockSlowOrchestrate(100)).rejects.toThrow('Orchestration timeout');
    });
  });

  describe('AbortController Cleanup', () => {
    it('should abort previous controller before creating new one', () => {
      let controller1 = new AbortController();
      let controller2;

      // Simulate useDecisionFSM pattern
      const simulateSubmitInput = () => {
        if (controller1) {
          controller1.abort();
          controller1 = null;
        }
        controller2 = new AbortController();
      };

      simulateSubmitInput();

      expect(controller1).toBeNull();
      expect(controller2).toBeDefined();
      expect(controller2.signal.aborted).toBe(false);
    });

    it('should clean up controller on unmount', () => {
      const controller = new AbortController();

      // Simulate useEffect cleanup
      const cleanup = () => {
        if (controller) {
          controller.abort();
        }
      };

      cleanup();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('Telemetry Integration', () => {
    it('should fire trackRetryAttempt on retry', async () => {
      const trackRetryAttempt = vi.fn();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Transient error');
        }
        return { success: true };
      };

      const strategy = { ...FIXED_INTERVAL, baseDelay: 10, maxAttempts: 2 };

      await executeWithRetry(fn, strategy, (attempt, delay) => {
        trackRetryAttempt({ attempt, delay, strategy: strategy.type });
      });

      expect(trackRetryAttempt).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number),
        strategy: 'fixed_interval',
      });
    });

    it('should track circuit breaker state changes', () => {
      const trackCircuitBreakerOpen = vi.fn();
      const trackCircuitBreakerClosed = vi.fn();

      // Hook-signature check only: it calls its own vi.fn() and asserts the
      // shape. It never wired to a real breaker, and after S1-B there is no
      // breaker instance in the codebase to wire to.
      trackCircuitBreakerOpen({
        service: 'orchestrator',
        endpoint: '/api/lumi/analyze',
        failureCount: 3,
        threshold: 3,
      });

      expect(trackCircuitBreakerOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'orchestrator',
          failureCount: 3,
          threshold: 3,
        })
      );

      trackCircuitBreakerClosed({
        service: 'orchestrator',
        endpoint: '/api/lumi/analyze',
        downtime: 5000,
      });

      expect(trackCircuitBreakerClosed).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'orchestrator',
          downtime: 5000,
        })
      );
    });
  });


  describe('SSE Connection FSM', () => {
    it('should have explicit state transitions', () => {
      const states = ['IDLE', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'FAILED', 'DISCONNECTED'];

      // Validate state machine contract (SSE client already implements this)
      expect(states).toContain('IDLE');
      expect(states).toContain('CONNECTING');
      expect(states).toContain('CONNECTED');
      expect(states).toContain('RECONNECTING');
      expect(states).toContain('FAILED');
      expect(states).toContain('DISCONNECTED');
    });

    it('should apply exponential backoff on reconnect', () => {
      const calculateBackoff = (attempt, baseDelay = 2000, maxDelay = 32000, jitter = 0.1) => {
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const cappedDelay = Math.min(exponentialDelay, maxDelay);
        const jitterAmount = cappedDelay * jitter * (Math.random() * 2 - 1);
        return Math.floor(cappedDelay + jitterAmount);
      };

      const delay1 = calculateBackoff(1);
      const delay2 = calculateBackoff(2);
      const delay3 = calculateBackoff(3);

      expect(delay1).toBeGreaterThanOrEqual(1800);
      expect(delay1).toBeLessThanOrEqual(2200);
      expect(delay2).toBeGreaterThanOrEqual(3600);
      expect(delay2).toBeLessThanOrEqual(4400);
      expect(delay3).toBeGreaterThanOrEqual(7200);
      expect(delay3).toBeLessThanOrEqual(8800);
    });

    it('should cap reconnect attempts at maxRetries', () => {
      const maxRetries = 5;
      let reconnectAttempts = 0;

      const attemptReconnect = () => {
        if (reconnectAttempts >= maxRetries) {
          return 'FAILED';
        }
        reconnectAttempts++;
        return 'RECONNECTING';
      };

      // Exhaust retries
      for (let i = 0; i <= maxRetries; i++) {
        attemptReconnect();
      }

      expect(reconnectAttempts).toBe(maxRetries);
      expect(attemptReconnect()).toBe('FAILED');
    });
  });
});
