// ============================================================
// Orchestrator Circuit Breaker (Phase 11B)
// ------------------------------------------------------------
// Circuit breaker wrapper for dual-agent orchestrator.
// Prevents cascading failures when Claude/GPT APIs degrade.
//
// Integration:
// - Wraps runOrchestration with circuit protection
// - Telemetry integration (Phase 10D hooks)
// - Graceful degradation (returns fallback on circuit open)
// ============================================================
import { CircuitBreaker } from './circuitBreaker.js';
import { runOrchestration } from '../agents/orchestrator.js';
import { logger } from '../utils/logger.js';
import { broadcastWorkspaceEvent } from '../lib/sseRegistry.js';

// ══════════════════════════════════════════════════════════════
// Circuit Breaker Instance
// ══════════════════════════════════════════════════════════════

/**
 * Orchestrator circuit breaker singleton
 *
 * Configuration:
 * - Opens after 3 consecutive failures
 * - Half-open test after 60s
 * - Requires 2 successes in half-open to close
 * - Minimum 5 calls before evaluating
 */
export const orchestratorCircuit = new CircuitBreaker({
  name: 'orchestrator',
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60_000, // 60s
  volumeThreshold: 5,

  // Telemetry callback
  onStateChange: (state, metrics) => {
    if (state === 'OPEN') {
      logger.error(
        {
          service: 'orchestrator',
          endpoint: '/api/lumi/analyze',
          failureCount: metrics.consecutiveFailures,
          threshold: 3,
          openDuration: 60_000,
        },
        '[OrchestratorCircuit] Circuit OPEN — AI orchestration degraded'
      );

      broadcastWorkspaceEvent('system', {
        type: 'CIRCUIT_BREAKER_OPEN',
        service: 'orchestrator',
        message: 'AI analysis temporarily unavailable. Using fallback mode.',
        openedAt: Date.now(),
      });
    }

    if (state === 'CLOSED') {
      const downtime = metrics.openedAt ? Date.now() - metrics.openedAt : 0;
      logger.info(
        {
          service: 'orchestrator',
          endpoint: '/api/lumi/analyze',
          downtime,
        },
        '[OrchestratorCircuit] Circuit CLOSED — orchestrator recovered'
      );

      broadcastWorkspaceEvent('system', {
        type: 'CIRCUIT_BREAKER_CLOSED',
        service: 'orchestrator',
        message: 'AI analysis restored.',
        downtime,
      });
    }

    if (state === 'HALF_OPEN') {
      logger.info(
        { service: 'orchestrator' },
        '[OrchestratorCircuit] Circuit HALF_OPEN — testing recovery'
      );
    }
  },
});

// ══════════════════════════════════════════════════════════════
// Wrapped Orchestrator Call
// ══════════════════════════════════════════════════════════════

/**
 * Execute orchestration with circuit breaker protection
 *
 * Wraps runOrchestration with:
 * - Fast-fail when circuit open
 * - Graceful degradation (fallback response)
 * - Automatic state tracking
 *
 * @param {Object} args - Orchestration arguments
 * @param {string} args.campaignId - Campaign ID
 * @param {string} args.workspaceId - Workspace ID
 * @param {string} [args.actionId] - Action ID (optional)
 * @param {string} [args.userId] - User ID (optional)
 * @returns {Promise<Object>} Orchestration result or fallback
 */
export async function executeOrchestration(args) {
  const result = await orchestratorCircuit.execute(async () => {
    return await runOrchestration(args);
  });

  // Circuit open → return graceful degradation
  if (!result.success && result.circuitState === 'OPEN') {
    logger.warn(
      { campaignId: args.campaignId, workspaceId: args.workspaceId },
      '[OrchestratorCircuit] Returning fallback due to open circuit'
    );

    return {
      strategicAnalysis: {
        verdict: 'HOLD',
        rootCause: 'CIRCUIT_OPEN',
        diagnosis:
          'AI analysis temporarily unavailable due to service degradation. Manual review recommended.',
        confidence: 0,
        riskLevel: 'Unknown',
        evidenceCount: 0,
        financialImpact: 'Unknown',
        actionPlan: {
          action: 'Manual review required - AI orchestrator unavailable',
          expectedImpact: 'No automated action recommended at this time',
        },
      },
      creativeAssets: null,
      orchestratedAt: new Date().toISOString(),
      creativeSkipped: true,
      creativeProvider: 'unconfigured',
      degraded: true,
      degradationReason: 'CIRCUIT_BREAKER_OPEN',
      circuitState: 'OPEN',
    };
  }

  // Circuit closed/half-open → return actual result
  if (result.success) {
    return result.data;
  }

  // Execution failed but circuit not open → rethrow
  throw result.error;
}

/**
 * Get orchestrator circuit health status
 *
 * @returns {Object} Circuit state and metrics
 */
export function getOrchestratorHealth() {
  const metrics = orchestratorCircuit.getMetrics();
  return {
    status: metrics.state === 'CLOSED' ? 'healthy' : 'degraded',
    state: metrics.state,
    failureCount: metrics.failureCount,
    successCount: metrics.successCount,
    consecutiveFailures: metrics.consecutiveFailures,
    uptime: metrics.openedAt ? Date.now() - metrics.openedAt : null,
    lastFailure: metrics.lastFailureTime,
  };
}

/**
 * Force circuit to open (for testing or maintenance)
 */
export function forceOpenCircuit() {
  orchestratorCircuit.forceOpen();
  logger.warn('[OrchestratorCircuit] Circuit manually opened');
}

/**
 * Force circuit to close (manual recovery)
 */
export function forceCloseCircuit() {
  orchestratorCircuit.forceClose();
  logger.info('[OrchestratorCircuit] Circuit manually closed');
}

/**
 * Reset circuit metrics (clear history)
 */
export function resetCircuit() {
  orchestratorCircuit.reset();
  logger.info('[OrchestratorCircuit] Circuit metrics reset');
}
