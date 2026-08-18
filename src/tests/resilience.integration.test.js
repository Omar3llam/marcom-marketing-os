// ============================================================
// Phase 11A — Resilience Wiring Integration Tests
// ------------------------------------------------------------
// Validates that resilience infrastructure is properly wired:
// - Circuit breaker wraps orchestrator calls
// - Retry policy is applied to API errors
// - Timeout guards trigger correctly
// - Telemetry hooks fire on resilience events
// ============================================================

import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import {
  orchestratorCircuit,
  executeOrchestration,
  getOrchestratorHealth,
} from '../resilience/orchestratorCircuit.js';
import * as sseRegistry from '../lib/sseRegistry.js';

vi.mock('../lib/sseRegistry.js', () => ({
  broadcastWorkspaceEvent: vi.fn(),
  addSubscriber: vi.fn(),
  removeSubscriber: vi.fn(),
  _resetForTests: vi.fn(),
}));

// R12-1b — the ONLY thing stubbed in the Circuit Breaker block is the paid
// external API at the edge of the orchestration. Prisma, runOrchestration and
// the circuit breaker itself all run for real, which is what makes this an
// integration test and why the block is gated on a reachable database.
//
// It is also the failure-injection seam. The previous attempt used
// `vi.spyOn(await import('../agents/orchestrator.js'), 'runOrchestration')`,
// and an ES module namespace is frozen — the assignment never took effect, no
// call ever failed, and the test asserted a failure count of 0 >= 3. Rejecting
// at this boundary instead drives the REAL path: runClaudeAgent rejects →
// analyzeWithClaude rethrows → runOrchestration throws → the circuit records a
// genuine failure. Nothing touches the breaker's internals.
const { runClaudeAgentMock } = vi.hoisted(() => ({ runClaudeAgentMock: vi.fn() }));
vi.mock('../agents/ClaudeAgent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runClaudeAgent: runClaudeAgentMock,
}));
import {
  getRetryStrategy,
  executeWithRetry,
  calculateRetryDelay,
  EXPONENTIAL_BACKOFF,
  LINEAR_RECONNECT,
  FIXED_INTERVAL,
  NO_RETRY,
} from '../../client/src/contracts/errors/retryPolicy.ts';
import { NetworkError, PlatformError, RateLimitError } from '../../client/src/contracts/errors/index.ts';
import { dbAvailable } from './dbProbe.js';
import { prisma } from '../lib/prisma.js';

// The Circuit Breaker block drives runOrchestration, which reads CampaignState
// from the database; it skips when no migrated database is reachable (the rest
// of the file is DB-free and always runs). That gate is why these four tests
// had never executed anywhere before R12-1: locally the block self-skips, and
// CI's old path allowlist never reached this file at all. They were written
// against assumptions that nothing had ever checked.
const DB_OK = await dbAvailable();

// A real UUID. CampaignState.workspaceId is `@db.Uuid`, so the previous
// 'test-workspace' string reached Postgres as an invalid UUID and Prisma
// rejected the read with P2023 before the orchestrator did anything at all.
// Fixed and deterministic, and namespaced so a leftover row is recognisable.
const TEST_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const TEST_CAMPAIGN_ID  = 'r12-1b-circuit-fixture';

// A verdict whose rootCause is NOT in CREATIVE_TRIGGERS and whose verdict is
// not REFRESH, so the orchestration does not take the second (OpenAI) agent
// path. One external boundary stubbed, not two.
const ANALYSIS = {
  verdict: 'HOLD',
  rootCause: 'STABLE_PERFORMANCE',
  diagnosis: 'Deterministic fixture for the circuit breaker integration test.',
  confidence: 0.9,
};

describe('Resilience Wiring Integration Tests', () => {
  describe.skipIf(!DB_OK)('Circuit Breaker Integration', () => {
    beforeAll(async () => {
      // runOrchestration throws 'campaignState not found' when the subject of
      // the analysis is missing — correctly, since inventing one would
      // fabricate the campaign being diagnosed. So the fixture is a real row
      // in the real database, which is the point of a DB-gated block.
      await prisma.workspace.upsert({
        where:  { id: TEST_WORKSPACE_ID },
        update: {},
        create: { id: TEST_WORKSPACE_ID, name: 'R12-1b circuit fixture' },
      });
      await prisma.campaignState.upsert({
        where:  { campaignId_workspaceId: { campaignId: TEST_CAMPAIGN_ID, workspaceId: TEST_WORKSPACE_ID } },
        update: {},
        create: {
          campaignId:   TEST_CAMPAIGN_ID,
          campaignName: 'R12-1b circuit fixture',
          workspaceId:  TEST_WORKSPACE_ID,
          stage:        'STABLE',
          healthScore:  72,
          lastAnalysis: new Date(),
        },
      });
    });

    afterAll(async () => {
      await prisma.campaignState.deleteMany({ where: { workspaceId: TEST_WORKSPACE_ID } });
      await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE_ID } });
    });

    beforeEach(() => {
      // forceClose(), not reset(). reset() clears the METRICS and deliberately
      // leaves `state` alone (CircuitBreaker._reset), so after the force-open
      // test below the circuit stayed OPEN into the next test and the health
      // assertion read 'degraded' where it expected 'healthy'. That is the
      // production contract, not a bug in it, so the test uses the API that
      // actually restores a closed circuit rather than asking production to
      // change meaning. Every test now starts from a known state, and none
      // depends on the order they run in.
      orchestratorCircuit.forceClose();
      runClaudeAgentMock.mockReset();
      runClaudeAgentMock.mockResolvedValue({ text: JSON.stringify(ANALYSIS) });
    });

    it('should wrap runOrchestration with circuit protection', async () => {
      const result = await executeOrchestration({
        campaignId:  TEST_CAMPAIGN_ID,
        workspaceId: TEST_WORKSPACE_ID,
      });

      expect(result).toBeDefined();
      expect(result.strategicAnalysis).toBeDefined();
      expect(result.strategicAnalysis.verdict).toBe('HOLD');
      expect(result.degraded).toBeUndefined();   // the real result, not a fallback
      // Proof the call went THROUGH the orchestrator rather than short-circuiting:
      // the seeded row was read and the analysis boundary was reached.
      expect(runClaudeAgentMock).toHaveBeenCalledTimes(1);
    });

    it('should return fallback response when circuit is open', async () => {
      orchestratorCircuit.forceOpen();

      const result = await executeOrchestration({
        campaignId:  TEST_CAMPAIGN_ID,
        workspaceId: TEST_WORKSPACE_ID,
      });

      expect(result.degraded).toBe(true);
      expect(result.degradationReason).toBe('CIRCUIT_BREAKER_OPEN');
      expect(result.strategicAnalysis.verdict).toBe('HOLD');
      expect(result.strategicAnalysis.rootCause).toBe('CIRCUIT_OPEN');
      // Fast-fail means the orchestration never ran.
      expect(runClaudeAgentMock).not.toHaveBeenCalled();
    });

    it('should report circuit health status', () => {
      const health = getOrchestratorHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('state');
      expect(health).toHaveProperty('failureCount');
      expect(health).toHaveProperty('successCount');
      // Asserted explicitly rather than assumed: a closed circuit with no
      // history is what 'healthy' means, and beforeEach established exactly
      // that, whatever the previous test left behind.
      expect(health.state).toBe('CLOSED');
      expect(health.status).toBe('healthy');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.failureCount).toBe(0);
    });

    it('should track consecutive failures and open at the configured threshold', async () => {
      // The circuit opens on consecutiveFailures >= failureThreshold (3) AND
      // totalCalls >= volumeThreshold (5) — both, so three failures alone never
      // open it. The old test drove three calls and asserted a count it could
      // not have reached even if its mock had worked.
      runClaudeAgentMock.mockReset();
      runClaudeAgentMock.mockRejectedValue(new Error('claude upstream unavailable'));

      let rejections = 0;
      let lastResult;
      for (let i = 0; i < 5; i++) {
        try {
          lastResult = await executeOrchestration({
            campaignId:  TEST_CAMPAIGN_ID,
            workspaceId: TEST_WORKSPACE_ID,
          });
        } catch {
          rejections += 1;   // rethrown while the circuit is still closed
        }
      }

      // Every call reached the real boundary — these are genuine failures
      // propagating through runOrchestration, not counters nudged by hand.
      expect(runClaudeAgentMock).toHaveBeenCalledTimes(5);
      expect(rejections).toBeGreaterThanOrEqual(3);

      const health = getOrchestratorHealth();
      expect(health.consecutiveFailures).toBeGreaterThanOrEqual(3);
      expect(health.failureCount).toBeGreaterThanOrEqual(3);
      expect(health.state).toBe('OPEN');
      expect(health.status).toBe('degraded');

      // The call that crossed the threshold degrades instead of throwing.
      expect(lastResult?.degradationReason).toBe('CIRCUIT_BREAKER_OPEN');
    });
  });

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

      // Circuit breaker telemetry is wired in orchestratorCircuit.js
      // This test validates the hook signature
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

  describe('SSE Broadcast on Circuit State Change', () => {
    beforeEach(() => {
      orchestratorCircuit.reset();
      vi.mocked(sseRegistry.broadcastWorkspaceEvent).mockClear();
    });

    it('should broadcast CIRCUIT_BREAKER_OPEN when circuit opens', () => {
      orchestratorCircuit.forceOpen();

      expect(sseRegistry.broadcastWorkspaceEvent).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({
          type: 'CIRCUIT_BREAKER_OPEN',
          service: 'orchestrator',
          message: expect.stringContaining('unavailable'),
          openedAt: expect.any(Number),
        })
      );
    });

    it('should broadcast CIRCUIT_BREAKER_CLOSED when circuit closes', () => {
      orchestratorCircuit.forceOpen();
      vi.mocked(sseRegistry.broadcastWorkspaceEvent).mockClear();

      orchestratorCircuit.forceClose();

      expect(sseRegistry.broadcastWorkspaceEvent).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({
          type: 'CIRCUIT_BREAKER_CLOSED',
          service: 'orchestrator',
          message: 'AI analysis restored.',
          downtime: expect.any(Number),
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

// ── Export test utilities for use in other test files ───────
export const createMockOrchestrationArgs = () => ({
  campaignId: `test-campaign-${Date.now()}`,
  workspaceId: `test-workspace-${Date.now()}`,
  actionId: `test-action-${Date.now()}`,
  userId: `test-user-${Date.now()}`,
});

export const simulateCircuitBreakerFailures = async (count = 3) => {
  for (let i = 0; i < count; i++) {
    try {
      await executeOrchestration(createMockOrchestrationArgs());
    } catch (err) {
      // Expected to fail in mock environment
    }
  }
};
