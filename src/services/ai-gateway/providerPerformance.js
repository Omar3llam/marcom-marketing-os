// ============================================================
// Provider Performance Scorer — PR #38
// ============================================================
// Queries approval decision analytics to score AI providers
// by capability, enabling data-driven provider routing.
//
// USAGE:
//   const scores = await getProviderPerformance('GENERATE_HOOKS');
//   // Returns ranked list of providers with approval rates
//
// CACHING:
//   Results cached in-memory with 5-minute TTL to avoid
//   hammering the database on every execution.
//
// SCORING ALGORITHM:
//   Primary: approval rate (% of APPROVED decisions)
//   Secondary: risk score (weighted rejection/regen count)
//   Tertiary: total sample size (confidence penalty for low N)
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

// Cache performance data for 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const performanceCache = new Map();

/**
 * Clear the performance cache (used in tests).
 */
export function clearPerformanceCache() {
  performanceCache.clear();
}

/**
 * Get provider performance scores for a specific capability.
 *
 * @param {string} capability - The capability to score (e.g., 'GENERATE_HOOKS')
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional, defaults to all workspaces)
 * @param {Date} options.startDate - Start date for analytics window (optional, defaults to 30 days ago)
 * @param {Date} options.endDate - End date for analytics window (optional, defaults to now)
 * @param {number} options.minSampleSize - Minimum decisions required for a provider to be scored (optional, defaults to 3)
 * @returns {Promise<Array<{ provider: string, approvalRate: number, riskScore: number, total: number, confidence: number }>>}
 */
export async function getProviderPerformance(capability, options = {}) {
  const {
    workspaceId = null,
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    endDate = new Date(),
    minSampleSize = 3,
  } = options;

  // Check cache
  const cacheKey = JSON.stringify({ capability, workspaceId, startDate, endDate, minSampleSize });
  const cached = performanceCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug({
      capability,
      workspaceId,
      cacheAge: Date.now() - cached.timestamp,
    }, '[providerPerformance] cache hit');

    return cached.data;
  }

  // Query approval decisions for this capability
  const where = {
    capability,
    reviewedAt: {
      gte: startDate,
      lte: endDate,
    },
    provider: { not: null },
  };

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  const decisions = await prisma.approvalDecision.findMany({
    where,
    select: {
      provider: true,
      decision: true,
    },
  });

  logger.debug({
    capability,
    workspaceId,
    totalDecisions: decisions.length,
  }, '[providerPerformance] queried approval decisions');

  // Group by provider and calculate scores
  const providerGroups = _groupBy(decisions, 'provider');
  const scores = [];

  for (const [provider, providerDecisions] of Object.entries(providerGroups)) {
    const total = providerDecisions.length;

    // Skip providers with insufficient sample size
    if (total < minSampleSize) {
      logger.debug({
        capability,
        provider,
        total,
        minSampleSize,
      }, '[providerPerformance] skipping provider (insufficient sample size)');
      continue;
    }

    const byDecision = _groupBy(providerDecisions, 'decision');
    const approved = byDecision.APPROVED?.length || 0;
    const rejected = byDecision.REJECTED?.length || 0;
    const regenerate = byDecision.REGENERATE?.length || 0;
    const requestRevision = byDecision.REQUEST_REVISION?.length || 0;

    // Approval rate: % of decisions that were APPROVED
    const approvalRate = (approved / total) * 100;

    // Risk score: weighted penalty for rejections/regen
    // rejection=3pts, regenerate=2pts, revision=1pt
    const riskScore = (rejected * 3 + regenerate * 2 + requestRevision * 1) / total;

    // Confidence: logarithmic penalty for low sample sizes
    // confidence = 1.0 at N=100+, scales down for N<100
    const confidence = Math.min(1.0, Math.log10(total + 1) / 2.0);

    scores.push({
      provider,
      approvalRate: Math.round(approvalRate * 100) / 100, // 2 decimals
      riskScore: Math.round(riskScore * 100) / 100,       // 2 decimals
      total,
      confidence: Math.round(confidence * 100) / 100,     // 2 decimals
    });
  }

  // Sort by approval rate (descending), then by confidence (descending)
  scores.sort((a, b) => {
    if (Math.abs(a.approvalRate - b.approvalRate) > 0.1) {
      return b.approvalRate - a.approvalRate; // Higher approval rate wins
    }
    return b.confidence - a.confidence; // Higher confidence wins (tie-breaker)
  });

  // Cache results
  performanceCache.set(cacheKey, {
    data: scores,
    timestamp: Date.now(),
  });

  logger.info({
    capability,
    workspaceId,
    providersScored: scores.length,
    topProvider: scores[0]?.provider,
    topApprovalRate: scores[0]?.approvalRate,
  }, '[providerPerformance] provider scores calculated');

  return scores;
}

/**
 * Get the best-performing provider for a capability.
 *
 * @param {string} capability - The capability to route
 * @param {object} options - Query options (same as getProviderPerformance)
 * @returns {Promise<{ provider: string, score: object, reason: string } | null>}
 */
export async function getBestProvider(capability, options = {}) {
  const scores = await getProviderPerformance(capability, options);

  if (scores.length === 0) {
    return null;
  }

  const best = scores[0];

  return {
    provider: best.provider,
    score: best,
    reason: `${best.approvalRate}% approval rate (${best.total} decisions, ${Math.round(best.confidence * 100)}% confidence)`,
  };
}

// ============================================================
// Helper Functions
// ============================================================

function _groupBy(array, field) {
  return array.reduce((acc, item) => {
    const key = item[field];
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
