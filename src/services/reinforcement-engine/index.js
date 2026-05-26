// ============================================================
// Adaptive Reinforcement Engine — PR #42
// ============================================================
// Public API for the reinforcement learning system.
//
// FEATURES:
//   - Autonomous learning from real performance data
//   - Dynamic provider weight adjustments
//   - Budget allocation recommendations
//   - Safety constraints and oscillation detection
//
// USAGE:
//   import { updateProviderScores, getRecommendations } from './services/reinforcement-engine/index.js';
//
//   // Update scores (run periodically, e.g., daily)
//   await updateProviderScores('GENERATE_HOOKS');
//
//   // Get recommendations
//   const recs = await getRecommendations('GENERATE_HOOKS', currentWeights);
//
// EVENTS:
//   - PROVIDER_WEIGHT_UPDATED: when weights change
//   - BUDGET_REALLOCATED: when budget shifts
//   - PERFORMANCE_DECAY_APPLIED: when decay affects scores
//   - ROUTING_STRATEGY_CHANGED: when routing strategy changes
//
// SAFETY:
//   - All operations are deterministic (no randomness)
//   - All writes are append-only (no mutations)
//   - All changes respect safety constraints
// ============================================================
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import {
  calculateProviderScore,
  calculateAllProviderScores,
  CONSTANTS as SCORING_CONSTANTS,
} from './scoringEngine.js';
import {
  saveSnapshot,
  getSnapshotHistory,
  getLatestSnapshot,
  getLatestSnapshotsForCapability,
  calculateScoreTrend,
  getCapabilityStats,
} from './memoryManager.js';
import {
  generateRecommendations,
  calculateBudgetAllocation,
  detectOscillation,
  CONSTRAINTS as ALLOCATION_CONSTRAINTS,
} from './budgetAllocator.js';

// Event emitter for reinforcement events
const reinforcementEvents = new EventEmitter();

/**
 * Update provider scores for a capability.
 *
 * Calculates new scores and saves snapshots to memory.
 * Run this periodically (e.g., daily) to update reinforcement learning state.
 *
 * @param {string} capability - Capability name
 * @param {object} options - Update options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {Date} options.windowStart - Performance window start (optional, defaults to 90 days ago)
 * @param {Date} options.windowEnd - Performance window end (optional, defaults to now)
 * @returns {Promise<Array<{ provider: string, score: number, confidence: number, snapshot: object }>>}
 */
export async function updateProviderScores(capability, options = {}) {
  const {
    workspaceId = null,
    windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
    windowEnd = new Date(),
  } = options;

  logger.info({
    capability,
    workspaceId,
    windowStart,
    windowEnd,
  }, '[reinforcementEngine] updating provider scores');

  // Calculate scores for all providers
  const scores = await calculateAllProviderScores(capability, {
    workspaceId,
    windowStart,
    windowEnd,
  });

  // Save snapshots
  const results = [];

  for (const scoreData of scores) {
    const snapshot = await saveSnapshot({
      provider: scoreData.provider,
      capability,
      score: scoreData.score,
      confidence: scoreData.confidence,
      sampleSize: scoreData.sampleSize,
      windowStart,
      windowEnd,
      workspaceId,
    });

    results.push({
      provider: scoreData.provider,
      score: scoreData.score,
      confidence: scoreData.confidence,
      snapshot,
    });

    // Emit event
    reinforcementEvents.emit('PERFORMANCE_DECAY_APPLIED', {
      provider: scoreData.provider,
      capability,
      score: scoreData.score,
      confidence: scoreData.confidence,
      workspaceId,
      timestamp: new Date(),
    });
  }

  logger.info({
    capability,
    providersUpdated: results.length,
  }, '[reinforcementEngine] scores updated');

  return results;
}

/**
 * Get traffic redistribution recommendations for a capability.
 *
 * @param {string} capability - Capability name
 * @param {object} currentWeights - Current traffic weights { provider: weight }
 * @param {object} options - Recommendation options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {number} options.maxWeightChange - Max weight change (optional)
 * @param {number} options.minProviderWeight - Min weight per provider (optional)
 * @param {number} options.confidenceThreshold - Min confidence for changes (optional)
 * @returns {Promise<Array<object>>} Recommendations
 */
export async function getRecommendations(capability, currentWeights = {}, options = {}) {
  logger.info({
    capability,
    currentProviders: Object.keys(currentWeights).length,
  }, '[reinforcementEngine] generating recommendations');

  const recommendations = await generateRecommendations(capability, currentWeights, options);

  // Check for significant changes
  const significantChanges = recommendations.filter(r => Math.abs(r.scoreChange) > 0.05);

  if (significantChanges.length > 0) {
    logger.info({
      capability,
      significantChanges: significantChanges.length,
    }, '[reinforcementEngine] significant weight changes recommended');

    // Emit event
    reinforcementEvents.emit('ROUTING_STRATEGY_CHANGED', {
      capability,
      changes: significantChanges.length,
      recommendations: significantChanges,
      timestamp: new Date(),
    });
  }

  return recommendations;
}

/**
 * Apply weight recommendations (update routing weights).
 *
 * This is the action function that actually changes provider routing.
 * Call this AFTER reviewing recommendations.
 *
 * @param {string} capability - Capability name
 * @param {Array<object>} recommendations - Recommendations from getRecommendations()
 * @param {object} options - Apply options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {function} options.updateWeightsCallback - Callback to update routing weights (required)
 * @returns {Promise<{ applied: number, skipped: number, newWeights: object }>}
 */
export async function applyWeightRecommendations(capability, recommendations, options = {}) {
  const {
    workspaceId = null,
    updateWeightsCallback,
  } = options;

  if (typeof updateWeightsCallback !== 'function') {
    throw new Error('updateWeightsCallback is required');
  }

  logger.info({
    capability,
    recommendations: recommendations.length,
  }, '[reinforcementEngine] applying weight recommendations');

  let applied = 0;
  let skipped = 0;
  const newWeights = {};

  for (const rec of recommendations) {
    // Skip if no significant change
    if (Math.abs(rec.scoreChange) < 0.01) {
      skipped++;
      newWeights[rec.provider] = rec.currentWeight;
      continue;
    }

    // Apply recommendation
    newWeights[rec.provider] = rec.recommendedWeight;
    applied++;

    // Emit event
    reinforcementEvents.emit('PROVIDER_WEIGHT_UPDATED', {
      capability,
      provider: rec.provider,
      oldWeight: rec.currentWeight,
      newWeight: rec.recommendedWeight,
      change: rec.scoreChange,
      score: rec.score,
      confidence: rec.confidence,
      workspaceId,
      timestamp: new Date(),
    });
  }

  // Call update callback
  await updateWeightsCallback(capability, newWeights);

  logger.info({
    capability,
    applied,
    skipped,
  }, '[reinforcementEngine] weight recommendations applied');

  return {
    applied,
    skipped,
    newWeights,
  };
}

/**
 * Get budget allocation recommendations.
 *
 * @param {number} totalBudget - Total budget to allocate (USD)
 * @param {string} capability - Capability name
 * @param {object} providerCosts - Cost per request { provider: costPerRequest }
 * @param {object} options - Allocation options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @returns {Promise<object>} Budget allocation { provider: { budget, estimatedRequests } }
 */
export async function getBudgetAllocation(totalBudget, capability, providerCosts, options = {}) {
  const { workspaceId = null } = options;

  logger.info({
    totalBudget,
    capability,
  }, '[reinforcementEngine] calculating budget allocation');

  // Get latest snapshots to derive traffic weights
  const snapshots = await getLatestSnapshotsForCapability(capability, { workspaceId });

  if (snapshots.length === 0) {
    throw new Error(`No snapshots found for capability: ${capability}`);
  }

  // Calculate traffic weights from scores
  const totalScore = snapshots.reduce((sum, s) => sum + s.score, 0);
  const trafficWeights = {};

  for (const snapshot of snapshots) {
    trafficWeights[snapshot.provider] = totalScore > 0
      ? snapshot.score / totalScore
      : 1 / snapshots.length; // Equal split if total is zero
  }

  // Calculate budget allocation
  const allocation = calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts);

  // Emit event
  reinforcementEvents.emit('BUDGET_REALLOCATED', {
    capability,
    totalBudget,
    allocation,
    workspaceId,
    timestamp: new Date(),
  });

  logger.info({
    capability,
    providers: Object.keys(allocation).length,
  }, '[reinforcementEngine] budget allocation calculated');

  return allocation;
}

/**
 * Get performance trend for a provider + capability.
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {object} options - Trend options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {number} options.lookbackDays - Days to analyze (optional, default 30)
 * @returns {Promise<{ trend: string, change: number, snapshots: number }>}
 */
export async function getPerformanceTrend(provider, capability, options = {}) {
  return calculateScoreTrend(provider, capability, options);
}

/**
 * Get capability statistics (aggregate across all providers).
 *
 * @param {string} capability - Capability name
 * @param {object} options - Stats options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @returns {Promise<{ providers: number, avgScore: number, avgConfidence: number, totalSampleSize: number }>}
 */
export async function getCapabilityStatistics(capability, options = {}) {
  return getCapabilityStats(capability, options);
}

/**
 * Check for routing oscillation.
 *
 * @param {Array<object>} recentRecommendations - Recent recommendation history
 * @param {object} options - Detection options
 * @returns {boolean} True if oscillation detected
 */
export function checkOscillation(recentRecommendations, options = {}) {
  const oscillating = detectOscillation(recentRecommendations, options);

  if (oscillating) {
    logger.warn({
      recommendations: recentRecommendations.length,
    }, '[reinforcementEngine] routing oscillation detected');
  }

  return oscillating;
}

/**
 * Get reinforcement engine health status.
 *
 * @returns {Promise<{ status: string, capabilities: number, providers: number, snapshots: number }>}
 */
export async function getHealthStatus() {
  // This would query database for overall health metrics
  // For now, return a simple status
  return {
    status: 'healthy',
    capabilities: 0, // TODO: count distinct capabilities in snapshots
    providers: 0,    // TODO: count distinct providers in snapshots
    snapshots: 0,    // TODO: count total snapshots
  };
}

// Event emitter export
export { reinforcementEvents };

// Re-export submodule functions for convenience
export {
  calculateProviderScore,
  calculateAllProviderScores,
  getSnapshotHistory,
  getLatestSnapshot,
  getLatestSnapshotsForCapability,
  generateRecommendations as generateTrafficRecommendations,
  calculateBudgetAllocation as calculateBudgetSplit,
  detectOscillation,
};

// Export constants
export const CONSTANTS = {
  ...SCORING_CONSTANTS,
  ...ALLOCATION_CONSTRAINTS,
};
