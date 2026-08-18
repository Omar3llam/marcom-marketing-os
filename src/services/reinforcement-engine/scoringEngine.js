// ============================================================
// Adaptive Scoring Engine — PR #42
// ============================================================
// Calculates recency-weighted provider scores for reinforcement learning.
//
// FEATURES:
//   - Recency decay: recent performance weighs more than historical
//   - Multi-metric: approval rate, CTR, ROAS, cost efficiency
//   - Confidence tracking: based on sample size
//   - Capability-specific: (provider, capability) scoping
//
// SCORING FORMULA:
//   score = Σ(metric_i × weight_i × decayFactor(daysAgo))
//
// DECAY FUNCTION:
//   decayFactor(daysAgo) = exp(-λ × daysAgo)
//   where λ = 0.023 (half-life ≈ 30 days)
//
// SAFETY:
//   - MIN_SAMPLE_SIZE: require at least N data points
//   - CONFIDENCE_THRESHOLD: only trust scores with confidence >= threshold
//   - Deterministic: same inputs → same outputs (no randomness)
// ============================================================
// R11 (F26): shared Prisma client — this module used to open its own pool.
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';


// Recency decay configuration
const DECAY_LAMBDA = 0.023; // Half-life ≈ 30 days (ln(2) / 30)
const MIN_SAMPLE_SIZE = 10; // Minimum data points for scoring
const CONFIDENCE_THRESHOLD = 0.6; // Minimum confidence for routing changes

// Metric weights (must sum to 1.0)
const METRIC_WEIGHTS = {
  approvalRate: 0.35,     // 35% weight: human approval quality
  ctr: 0.25,              // 25% weight: click-through rate
  roas: 0.25,             // 25% weight: return on ad spend
  costEfficiency: 0.15,   // 15% weight: cost per approval
};

/**
 * Calculate recency decay factor for a given age in days.
 *
 * Uses exponential decay: decayFactor(t) = exp(-λ × t)
 * where λ = 0.023 (half-life ≈ 30 days)
 *
 * Examples:
 *   - 0 days ago: 1.0 (full weight)
 *   - 30 days ago: 0.5 (half weight)
 *   - 60 days ago: 0.25 (quarter weight)
 *
 * @param {number} daysAgo - Age of data point in days
 * @returns {number} Decay factor (0.0 - 1.0)
 */
export function calculateDecayFactor(daysAgo) {
  if (daysAgo < 0) {
    throw new Error(`Invalid daysAgo: ${daysAgo} (must be >= 0)`);
  }
  return Math.exp(-DECAY_LAMBDA * daysAgo);
}

/**
 * Calculate confidence level based on sample size.
 *
 * Uses logarithmic scaling:
 *   - confidence = log10(N + 1) / log10(101) where 101 gives confidence = 1.0
 *   - N < MIN_SAMPLE_SIZE → confidence = 0.0
 *
 * Examples:
 *   - N = 0: 0.0
 *   - N = 10: ~0.52
 *   - N = 100: 1.0
 *   - N = 1000: 1.0 (capped)
 *
 * @param {number} sampleSize - Number of data points
 * @returns {number} Confidence level (0.0 - 1.0)
 */
export function calculateConfidence(sampleSize) {
  if (sampleSize < MIN_SAMPLE_SIZE) {
    return 0.0;
  }
  return Math.min(1.0, Math.log10(sampleSize + 1) / Math.log10(101));
}

/**
 * Normalize a metric value to 0-100 scale.
 *
 * @param {number} value - Raw metric value
 * @param {number} min - Expected minimum value
 * @param {number} max - Expected maximum value
 * @returns {number} Normalized score (0-100)
 */
function normalizeMetric(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  if (max === min) {
    return 100; // Avoid division by zero
  }
  const normalized = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

/**
 * Calculate composite score for a provider + capability pair.
 *
 * Queries approval decisions and performance metrics, applies recency weighting,
 * and returns a composite score based on multiple metrics.
 *
 * @param {string} provider - Provider name (e.g., 'claude', 'openai')
 * @param {string} capability - Capability name (e.g., 'GENERATE_HOOKS')
 * @param {object} options - Scoring options
 * @param {string} options.workspaceId - Workspace ID for scoping (optional)
 * @param {Date} options.windowStart - Start of performance window (optional, defaults to 90 days ago)
 * @param {Date} options.windowEnd - End of performance window (optional, defaults to now)
 * @param {object} options.metricWeights - Custom metric weights (optional, defaults to METRIC_WEIGHTS)
 * @returns {Promise<{ score: number, confidence: number, sampleSize: number, breakdown: object }>}
 */
export async function calculateProviderScore(provider, capability, options = {}) {
  const {
    workspaceId = null,
    windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
    windowEnd = new Date(),
    metricWeights = METRIC_WEIGHTS,
  } = options;

  logger.debug({
    provider,
    capability,
    workspaceId,
    windowStart,
    windowEnd,
  }, '[scoringEngine] calculating provider score');

  // 1. Query approval decisions (for approval rate)
  const approvalWhere = {
    provider,
    capability,
    reviewedAt: {
      gte: windowStart,
      lte: windowEnd,
    },
  };

  if (workspaceId) {
    approvalWhere.workspaceId = workspaceId;
  }

  const approvalDecisions = await prisma.approvalDecision.findMany({
    where: approvalWhere,
    select: {
      decision: true,
      reviewedAt: true,
    },
  });

  // 2. Query performance metrics (for CTR, ROAS)
  const metricsWhere = {
    provider,
    capability,
    startDate: {
      gte: windowStart,
    },
    endDate: {
      lte: windowEnd,
    },
  };

  if (workspaceId) {
    metricsWhere.workspaceId = workspaceId;
  }

  const performanceMetrics = await prisma.providerPerformanceMetrics.findMany({
    where: metricsWhere,
    select: {
      ctr: true,
      roas: true,
      startDate: true,
      impressions: true,
    },
  });

  // Calculate sample size
  const sampleSize = approvalDecisions.length + performanceMetrics.length;

  // Calculate confidence
  const confidence = calculateConfidence(sampleSize);

  // If insufficient data, return zero score
  if (sampleSize < MIN_SAMPLE_SIZE) {
    logger.warn({
      provider,
      capability,
      sampleSize,
      minRequired: MIN_SAMPLE_SIZE,
    }, '[scoringEngine] insufficient sample size');

    return {
      score: 0,
      confidence: 0,
      sampleSize,
      breakdown: {
        approvalRate: 0,
        ctr: 0,
        roas: 0,
        costEfficiency: 0,
      },
    };
  }

  // 3. Calculate approval rate (with recency weighting)
  let approvalRateScore = 0;
  let totalApprovalWeight = 0;

  for (const decision of approvalDecisions) {
    const daysAgo = (windowEnd - new Date(decision.reviewedAt)) / (1000 * 60 * 60 * 24);
    const decayFactor = calculateDecayFactor(daysAgo);
    const isApproved = decision.decision === 'APPROVED' ? 100 : 0;

    approvalRateScore += isApproved * decayFactor;
    totalApprovalWeight += decayFactor;
  }

  const weightedApprovalRate = totalApprovalWeight > 0
    ? approvalRateScore / totalApprovalWeight
    : 0;

  // 4. Calculate CTR (with recency weighting)
  let ctrScore = 0;
  let totalCtrWeight = 0;

  for (const metric of performanceMetrics) {
    if (metric.ctr == null || metric.impressions < 100) continue; // Require meaningful impression count

    const daysAgo = (windowEnd - new Date(metric.startDate)) / (1000 * 60 * 60 * 24);
    const decayFactor = calculateDecayFactor(daysAgo);
    const normalizedCtr = normalizeMetric(metric.ctr, 0, 10); // Assume CTR 0-10% range

    ctrScore += normalizedCtr * decayFactor;
    totalCtrWeight += decayFactor;
  }

  const weightedCtr = totalCtrWeight > 0
    ? ctrScore / totalCtrWeight
    : 0;

  // 5. Calculate ROAS (with recency weighting)
  let roasScore = 0;
  let totalRoasWeight = 0;

  for (const metric of performanceMetrics) {
    if (metric.roas == null) continue;

    const daysAgo = (windowEnd - new Date(metric.startDate)) / (1000 * 60 * 60 * 24);
    const decayFactor = calculateDecayFactor(daysAgo);
    const normalizedRoas = normalizeMetric(metric.roas, 0, 5); // Assume ROAS 0-5x range

    roasScore += normalizedRoas * decayFactor;
    totalRoasWeight += decayFactor;
  }

  const weightedRoas = totalRoasWeight > 0
    ? roasScore / totalRoasWeight
    : 0;

  // 6. Calculate cost efficiency (inverse of cost per approval)
  // NOTE: executionCost field not yet in ApprovalDecision schema
  // TODO: Add executionCost tracking in future PR for full cost optimization
  const totalCost = 0; // Cost tracking not yet implemented
  const approvedCount = approvalDecisions.filter(d => d.decision === 'APPROVED').length;
  const costPerApproval = totalCost > 0 && approvedCount > 0 ? totalCost / approvedCount : 0;

  // Normalize cost efficiency (lower cost = higher score)
  // Assume cost per approval range: $0.01 - $0.50
  const costEfficiencyScore = costPerApproval === Infinity
    ? 0
    : normalizeMetric(0.5 - costPerApproval, 0, 0.49);

  // 7. Calculate composite score
  const compositeScore = (
    weightedApprovalRate * metricWeights.approvalRate +
    weightedCtr * metricWeights.ctr +
    weightedRoas * metricWeights.roas +
    costEfficiencyScore * metricWeights.costEfficiency
  );

  logger.info({
    provider,
    capability,
    compositeScore: Math.round(compositeScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    sampleSize,
  }, '[scoringEngine] calculated provider score');

  return {
    score: Math.round(compositeScore * 100) / 100, // 2 decimals
    confidence: Math.round(confidence * 100) / 100, // 2 decimals
    sampleSize,
    breakdown: {
      approvalRate: Math.round(weightedApprovalRate * 100) / 100,
      ctr: Math.round(weightedCtr * 100) / 100,
      roas: Math.round(weightedRoas * 100) / 100,
      costEfficiency: Math.round(costEfficiencyScore * 100) / 100,
    },
  };
}

/**
 * Calculate scores for all providers supporting a capability.
 *
 * @param {string} capability - Capability name
 * @param {object} options - Scoring options (same as calculateProviderScore)
 * @returns {Promise<Array<{ provider: string, score: number, confidence: number, sampleSize: number, breakdown: object }>>}
 */
export async function calculateAllProviderScores(capability, options = {}) {
  // Query all providers that have data for this capability
  const { workspaceId = null, windowStart, windowEnd } = options;

  const approvalWhere = {
    capability,
    provider: { not: null },
  };

  if (windowStart || windowEnd) {
    approvalWhere.reviewedAt = {};
    if (windowStart) approvalWhere.reviewedAt.gte = windowStart;
    if (windowEnd) approvalWhere.reviewedAt.lte = windowEnd;
  }

  if (workspaceId) {
    approvalWhere.workspaceId = workspaceId;
  }

  const decisions = await prisma.approvalDecision.findMany({
    where: approvalWhere,
    select: { provider: true },
    distinct: ['provider'],
  });

  const providers = [...new Set(decisions.map(d => d.provider))];

  logger.debug({
    capability,
    providersFound: providers.length,
  }, '[scoringEngine] calculating scores for all providers');

  // Calculate score for each provider
  const scores = await Promise.all(
    providers.map(async (provider) => {
      const result = await calculateProviderScore(provider, capability, options);
      return {
        provider,
        ...result,
      };
    })
  );

  // Sort by score descending, then by confidence descending
  return scores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.confidence - a.confidence;
  });
}

// Export constants for testing
export const CONSTANTS = {
  DECAY_LAMBDA,
  MIN_SAMPLE_SIZE,
  CONFIDENCE_THRESHOLD,
  METRIC_WEIGHTS,
};
