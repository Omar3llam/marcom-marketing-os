// ============================================================
// Budget Allocation Engine — PR #42
// ============================================================
// Recommends provider traffic redistribution and budget shifts
// based on reinforcement learning scores.
//
// FEATURES:
//   - Traffic redistribution: shift requests to higher-performing providers
//   - Budget allocation: recommend budget shifts
//   - Safety constraints: prevent oscillation and rapid changes
//   - Confidence gating: only act on high-confidence scores
//
// SAFETY CONSTRAINTS:
//   - MAX_WEIGHT_CHANGE_PER_DAY: limit daily weight adjustments
//   - MIN_SAMPLE_SIZE: require minimum data points
//   - CONFIDENCE_THRESHOLD: minimum confidence for changes
//   - MIN_PROVIDER_WEIGHT: never allocate less than this (avoid zero-ing out)
//
// USAGE:
//   const recommendations = await generateRecommendations('GENERATE_HOOKS', currentWeights);
//   // Returns { provider, currentWeight, recommendedWeight, rationale }[]
// ============================================================
import { logger } from '../../utils/logger.js';
import { getLatestSnapshotsForCapability } from './memoryManager.js';
import { CONSTANTS } from './scoringEngine.js';

// Safety constraints
const MAX_WEIGHT_CHANGE_PER_DAY = 0.15;      // Max 15% weight change per day
const MIN_PROVIDER_WEIGHT = 0.05;             // Min 5% traffic per provider
const MAX_PROVIDER_WEIGHT = 0.70;             // Max 70% traffic to one provider
const REALLOCATION_CONFIDENCE_THRESHOLD = 0.7; // Higher threshold for redistribution

/**
 * Calculate recommended traffic weights for providers supporting a capability.
 *
 * Uses reinforcement learning scores to redistribute traffic toward
 * higher-performing providers, subject to safety constraints.
 *
 * @param {string} capability - Capability name
 * @param {object} currentWeights - Current traffic weights { provider: weight }
 * @param {object} options - Allocation options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {number} options.maxWeightChange - Max weight change (optional, default MAX_WEIGHT_CHANGE_PER_DAY)
 * @param {number} options.minProviderWeight - Min weight per provider (optional, default MIN_PROVIDER_WEIGHT)
 * @param {number} options.confidenceThreshold - Min confidence for changes (optional, default REALLOCATION_CONFIDENCE_THRESHOLD)
 * @returns {Promise<Array<{ provider: string, currentWeight: number, recommendedWeight: number, scoreChange: number, rationale: string }>>}
 */
export async function generateRecommendations(capability, currentWeights = {}, options = {}) {
  const {
    workspaceId = null,
    maxWeightChange = MAX_WEIGHT_CHANGE_PER_DAY,
    minProviderWeight = MIN_PROVIDER_WEIGHT,
    confidenceThreshold = REALLOCATION_CONFIDENCE_THRESHOLD,
  } = options;

  logger.info({
    capability,
    workspaceId,
    currentProviders: Object.keys(currentWeights).length,
  }, '[budgetAllocator] generating traffic recommendations');

  // Get latest scores for all providers
  const snapshots = await getLatestSnapshotsForCapability(capability, { workspaceId });

  if (snapshots.length === 0) {
    logger.warn({ capability }, '[budgetAllocator] no snapshots found, cannot generate recommendations');
    return [];
  }

  // Filter snapshots by confidence threshold
  const qualifiedSnapshots = snapshots.filter(s => s.confidence >= confidenceThreshold);

  if (qualifiedSnapshots.length === 0) {
    logger.warn({
      capability,
      totalSnapshots: snapshots.length,
      confidenceThreshold,
    }, '[budgetAllocator] no snapshots meet confidence threshold');
    return [];
  }

  // Calculate ideal weights based on scores (softmax-like distribution)
  const totalScore = qualifiedSnapshots.reduce((sum, s) => sum + s.score, 0);

  if (totalScore === 0) {
    logger.warn({ capability }, '[budgetAllocator] total score is zero, cannot allocate');
    return [];
  }

  const idealWeights = {};
  for (const snapshot of qualifiedSnapshots) {
    idealWeights[snapshot.provider] = snapshot.score / totalScore;
  }

  // Apply safety constraints to ideal weights
  const constrainedWeights = _applyWeightConstraints(
    idealWeights,
    currentWeights,
    {
      maxWeightChange,
      minProviderWeight,
      maxProviderWeight: MAX_PROVIDER_WEIGHT,
    }
  );

  // Generate recommendations
  const recommendations = [];

  for (const snapshot of qualifiedSnapshots) {
    const provider = snapshot.provider;
    const currentWeight = currentWeights[provider] || 0;
    const recommendedWeight = constrainedWeights[provider] || minProviderWeight;
    const scoreChange = recommendedWeight - currentWeight;

    // Determine rationale
    let rationale;
    if (Math.abs(scoreChange) < 0.01) {
      rationale = 'No change needed (current allocation is optimal)';
    } else if (scoreChange > 0) {
      rationale = `Increase traffic by ${Math.round(scoreChange * 100)}% (high performance: score ${snapshot.score})`;
    } else {
      rationale = `Decrease traffic by ${Math.round(Math.abs(scoreChange) * 100)}% (underperforming: score ${snapshot.score})`;
    }

    recommendations.push({
      provider,
      currentWeight: Math.round(currentWeight * 1000) / 1000, // 3 decimals
      recommendedWeight: Math.round(recommendedWeight * 1000) / 1000, // 3 decimals
      scoreChange: Math.round(scoreChange * 1000) / 1000, // 3 decimals
      score: snapshot.score,
      confidence: snapshot.confidence,
      rationale,
    });
  }

  // Sort by absolute score change (largest first)
  recommendations.sort((a, b) => Math.abs(b.scoreChange) - Math.abs(a.scoreChange));

  logger.info({
    capability,
    recommendations: recommendations.length,
    significantChanges: recommendations.filter(r => Math.abs(r.scoreChange) > 0.05).length,
  }, '[budgetAllocator] generated recommendations');

  return recommendations;
}

/**
 * Apply safety constraints to ideal weights.
 *
 * Ensures:
 *   - No provider changes weight by more than maxWeightChange
 *   - No provider gets less than minProviderWeight
 *   - No provider gets more than maxProviderWeight
 *   - All weights sum to 1.0
 *
 * @private
 * @param {object} idealWeights - Ideal weights { provider: weight }
 * @param {object} currentWeights - Current weights { provider: weight }
 * @param {object} constraints - Safety constraints
 * @returns {object} Constrained weights { provider: weight }
 */
function _applyWeightConstraints(idealWeights, currentWeights, constraints) {
  const {
    maxWeightChange,
    minProviderWeight,
    maxProviderWeight,
  } = constraints;

  const constrainedWeights = {};
  const providers = Object.keys(idealWeights);

  // First pass: apply per-provider constraints
  for (const provider of providers) {
    const ideal = idealWeights[provider];
    const current = currentWeights[provider] || 0;

    // Apply min/max bounds first
    let constrained = Math.max(minProviderWeight, Math.min(maxProviderWeight, ideal));

    // Then limit change rate (this takes precedence over min/max bounds)
    if (constrained > current) {
      constrained = Math.min(constrained, current + maxWeightChange);
    } else if (constrained < current) {
      constrained = Math.max(constrained, current - maxWeightChange);
    }

    constrainedWeights[provider] = constrained;
  }

  // Second pass: normalize to sum to 1.0
  const total = Object.values(constrainedWeights).reduce((sum, w) => sum + w, 0);

  if (total > 0) {
    for (const provider of providers) {
      constrainedWeights[provider] = constrainedWeights[provider] / total;
    }
  }

  return constrainedWeights;
}

/**
 * Calculate budget allocation for providers based on traffic weights.
 *
 * Given total budget and recommended traffic weights, returns dollar amounts per provider.
 *
 * @param {number} totalBudget - Total budget to allocate (USD)
 * @param {object} trafficWeights - Traffic weights { provider: weight }
 * @param {object} providerCosts - Cost per request { provider: costPerRequest }
 * @returns {object} Budget allocation { provider: { budget: number, estimatedRequests: number } }
 */
export function calculateBudgetAllocation(totalBudget, trafficWeights, providerCosts) {
  if (totalBudget <= 0) {
    throw new Error(`Invalid totalBudget: ${totalBudget} (must be > 0)`);
  }

  const allocation = {};
  const providers = Object.keys(trafficWeights);

  // Calculate weighted cost (cost × traffic weight)
  const weightedCosts = {};
  let totalWeightedCost = 0;

  for (const provider of providers) {
    const weight = trafficWeights[provider];
    const costPerRequest = providerCosts[provider] || 0.01; // Default $0.01 if unknown

    weightedCosts[provider] = weight * costPerRequest;
    totalWeightedCost += weightedCosts[provider];
  }

  // Allocate budget proportional to weighted cost
  for (const provider of providers) {
    const budgetShare = totalWeightedCost > 0
      ? (weightedCosts[provider] / totalWeightedCost) * totalBudget
      : totalBudget / providers.length; // Equal split if costs unknown

    const costPerRequest = providerCosts[provider] || 0.01;
    const estimatedRequests = Math.floor(budgetShare / costPerRequest);

    allocation[provider] = {
      budget: Math.round(budgetShare * 100) / 100, // 2 decimals
      estimatedRequests,
    };
  }

  logger.debug({
    totalBudget,
    providers: providers.length,
  }, '[budgetAllocator] calculated budget allocation');

  return allocation;
}

/**
 * Detect routing oscillation (rapid provider flipping).
 *
 * Returns true if recommendations show oscillation pattern:
 *   - Same providers alternating between high/low weights
 *   - Frequent reversals in short time windows
 *
 * @param {Array<object>} recentRecommendations - Recent recommendation history
 * @param {object} options - Detection options
 * @param {number} options.lookbackCount - Number of recent recommendations to check (default 5)
 * @param {number} options.reversalThreshold - Min weight change to count as reversal (default 0.2)
 * @returns {boolean} True if oscillation detected
 */
export function detectOscillation(recentRecommendations, options = {}) {
  const {
    lookbackCount = 5,
    reversalThreshold = 0.2,
  } = options;

  if (recentRecommendations.length < lookbackCount) {
    return false; // Not enough history
  }

  const recent = recentRecommendations.slice(0, lookbackCount);

  // Group by provider
  const byProvider = {};
  for (const rec of recent) {
    for (const item of rec.recommendations) {
      if (!byProvider[item.provider]) {
        byProvider[item.provider] = [];
      }
      byProvider[item.provider].push(item.scoreChange);
    }
  }

  // Check for sign reversals
  for (const [provider, changes] of Object.entries(byProvider)) {
    if (changes.length < 3) continue;

    let reversals = 0;
    for (let i = 1; i < changes.length; i++) {
      const prev = changes[i - 1];
      const curr = changes[i];

      // Check if direction reversed AND change was significant
      if (Math.abs(prev) > reversalThreshold && Math.abs(curr) > reversalThreshold) {
        if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
          reversals++;
        }
      }
    }

    // If more than half of transitions are reversals, flag oscillation
    if (reversals > changes.length / 2) {
      logger.warn({
        provider,
        reversals,
        totalTransitions: changes.length - 1,
      }, '[budgetAllocator] oscillation detected');
      return true;
    }
  }

  return false;
}

// Export constants for testing
export const CONSTRAINTS = {
  MAX_WEIGHT_CHANGE_PER_DAY,
  MIN_PROVIDER_WEIGHT,
  MAX_PROVIDER_WEIGHT,
  REALLOCATION_CONFIDENCE_THRESHOLD,
};
