// ============================================================
// Intelligent Provider Router — PR #38 + PR #39
// ============================================================
// Routes AI capabilities to providers based on approval analytics
// performance data, with fallback to static registry.
//
// USAGE:
//   const registration = await routeCapability('GENERATE_HOOKS', {
//     workspaceId: 'ws-123',
//     enableIntelligentRouting: true,
//     enableActiveRouting: true
//   });
//   // Returns { provider, method, routingDecision }
//
// ROUTING STRATEGY (PR #39 — Active Mode):
//   1. If intelligent routing disabled → static registry
//   2. If no performance data → static registry (fallback)
//   3. If analytics agrees with static → use static (no change)
//   4. If analytics differs:
//      a. A/B test: 10% control group → static registry
//      b. 90% treatment group → analytics-recommended provider
//   5. If analytics provider doesn't support capability → static fallback
//
// FEATURE FLAGS:
//   ENABLE_INTELLIGENT_ROUTING=true  (default: false, enables analytics query)
//   ENABLE_ACTIVE_ROUTING=true       (default: false, enables provider switching)
//   AB_TEST_CONTROL_PERCENTAGE=10    (default: 10, % in control group)
// ============================================================
import crypto from 'crypto';
import { getProviderForCapability, getMethodForProvider } from './providerRegistry.js';
import { getBestProvider } from './providerPerformance.js';
import { logger } from '../../utils/logger.js';

// Feature flags (default: false for safety, enable via env)
const INTELLIGENT_ROUTING_ENABLED = process.env.ENABLE_INTELLIGENT_ROUTING === 'true';
const ACTIVE_ROUTING_ENABLED = process.env.ENABLE_ACTIVE_ROUTING === 'true';
const AB_TEST_CONTROL_PERCENTAGE = parseInt(process.env.AB_TEST_CONTROL_PERCENTAGE || '10', 10);

/**
 * Determine if request should be in A/B test control group.
 * Uses deterministic hashing to ensure same identifier → same group.
 *
 * @param {string} identifier - Unique identifier (e.g., requestId, workspaceId)
 * @param {number} controlPercentage - Percentage for control group (0-100)
 * @returns {boolean} True if in control group
 */
function isInControlGroup(identifier, controlPercentage = AB_TEST_CONTROL_PERCENTAGE) {
  if (controlPercentage <= 0) return false;
  if (controlPercentage >= 100) return true;

  // Hash identifier to get deterministic bucket assignment
  const hash = crypto.createHash('sha256').update(identifier).digest('hex');
  const bucket = parseInt(hash.slice(0, 8), 16) % 100; // 0-99
  return bucket < controlPercentage;
}

/**
 * Route a capability to the best-performing provider.
 *
 * PR #39: Now supports active routing with A/B testing.
 *
 * @param {string} capability - The capability to route
 * @param {object} options - Routing options
 * @param {string} options.workspaceId - Workspace ID for workspace-scoped routing (optional)
 * @param {string} options.requestId - Request ID for A/B test bucketing (optional)
 * @param {boolean} options.enableIntelligentRouting - Override feature flag (optional)
 * @param {boolean} options.enableActiveRouting - Override active routing flag (optional)
 * @param {object} options.performanceOptions - Options to pass to performance scorer (optional)
 * @returns {Promise<{ provider: string, method: function, routingDecision: object }>}
 */
export async function routeCapability(capability, options = {}) {
  const {
    workspaceId = null,
    requestId = null,
    enableIntelligentRouting = INTELLIGENT_ROUTING_ENABLED,
    enableActiveRouting = ACTIVE_ROUTING_ENABLED,
    performanceOptions = {},
  } = options;

  // If intelligent routing disabled, use static registry
  if (!enableIntelligentRouting) {
    const staticRegistration = getProviderForCapability(capability);
    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'static',
        reason: 'Intelligent routing disabled',
        fallback: false,
      },
    };
  }

  // Try to get best provider from analytics
  let bestProvider;
  try {
    bestProvider = await getBestProvider(capability, {
      workspaceId,
      ...performanceOptions,
    });
  } catch (error) {
    logger.warn({
      capability,
      workspaceId,
      error: error.message,
    }, '[intelligentRouter] performance query failed, falling back to static');

    const staticRegistration = getProviderForCapability(capability);
    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'static',
        reason: `Performance query failed: ${error.message}`,
        fallback: true,
      },
    };
  }

  // If no performance data, fallback to static
  if (!bestProvider) {
    logger.debug({
      capability,
      workspaceId,
    }, '[intelligentRouter] no performance data, falling back to static');

    const staticRegistration = getProviderForCapability(capability);
    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'static',
        reason: 'No performance data available (capability not yet scored)',
        fallback: true,
      },
    };
  }

  // Get static registry provider for comparison
  const staticRegistration = getProviderForCapability(capability);
  const analyticsProvider = bestProvider.provider;

  // Check if analytics-selected provider matches static registry
  if (analyticsProvider === staticRegistration.provider) {
    logger.debug({
      capability,
      provider: analyticsProvider,
      approvalRate: bestProvider.score.approvalRate,
    }, '[intelligentRouter] analytics agrees with static registry');

    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'performance-based',
        reason: `Best performer: ${bestProvider.reason} (agrees with static registry)`,
        fallback: false,
        performanceData: bestProvider.score,
      },
    };
  }

  // ============================================================
  // PR #39 — Active Routing Logic
  // ============================================================
  // Analytics suggests a different provider than static registry.
  // If active routing enabled, switch to analytics provider (with A/B test).

  // If active routing disabled, use observation mode (PR #38 behavior)
  if (!enableActiveRouting) {
    logger.info({
      capability,
      staticProvider: staticRegistration.provider,
      analyticsProvider,
      approvalRate: bestProvider.score.approvalRate,
      total: bestProvider.score.total,
    }, '[intelligentRouter] analytics suggests different provider (observation mode)');

    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'performance-based-passive',
        reason: `Static registry provider: ${staticRegistration.provider}. Analytics suggests: ${analyticsProvider} (${bestProvider.reason}) — observation mode`,
        fallback: false,
        performanceData: bestProvider.score,
        analyticsRecommendation: analyticsProvider,
      },
    };
  }

  // A/B Testing: Determine if this request is in control group
  const abTestIdentifier = requestId || workspaceId || `${capability}-default`;
  const inControlGroup = isInControlGroup(abTestIdentifier);

  if (inControlGroup) {
    logger.info({
      capability,
      staticProvider: staticRegistration.provider,
      analyticsProvider,
      abTestGroup: 'control',
    }, '[intelligentRouter] A/B test control group — using static provider');

    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'ab-test-control',
        reason: `A/B test control group: using static provider ${staticRegistration.provider}. Analytics suggests: ${analyticsProvider} (${bestProvider.reason})`,
        fallback: false,
        performanceData: bestProvider.score,
        analyticsRecommendation: analyticsProvider,
        abTestGroup: 'control',
      },
    };
  }

  // Treatment group: Try to route to analytics-recommended provider
  const analyticsRegistration = getMethodForProvider(analyticsProvider, capability);

  // If analytics provider doesn't support this capability, fallback to static
  if (!analyticsRegistration) {
    logger.warn({
      capability,
      analyticsProvider,
      staticProvider: staticRegistration.provider,
    }, '[intelligentRouter] analytics provider does not support capability, falling back to static');

    return {
      ...staticRegistration,
      routingDecision: {
        strategy: 'static',
        reason: `Analytics recommended ${analyticsProvider} but it doesn't support ${capability}. Using static: ${staticRegistration.provider}`,
        fallback: true,
        performanceData: bestProvider.score,
        analyticsRecommendation: analyticsProvider,
      },
    };
  }

  // SUCCESS: Use analytics-recommended provider (treatment group)
  logger.info({
    capability,
    staticProvider: staticRegistration.provider,
    analyticsProvider,
    approvalRate: bestProvider.score.approvalRate,
    total: bestProvider.score.total,
    abTestGroup: 'treatment',
  }, '[intelligentRouter] A/B test treatment group — routing to analytics provider');

  return {
    ...analyticsRegistration,
    routingDecision: {
      strategy: 'performance-based-active',
      reason: `Analytics-driven routing: ${analyticsProvider} (${bestProvider.reason}). Static was: ${staticRegistration.provider}. A/B test treatment group.`,
      fallback: false,
      performanceData: bestProvider.score,
      staticProvider: staticRegistration.provider,
      abTestGroup: 'treatment',
    },
  };
}

/**
 * Get routing statistics for observability.
 * Returns feature flag status and A/B test configuration.
 *
 * @returns {object} Routing statistics
 */
export function getRoutingStats() {
  return {
    intelligentRoutingEnabled: INTELLIGENT_ROUTING_ENABLED,
    activeRoutingEnabled: ACTIVE_ROUTING_ENABLED,
    abTestControlPercentage: AB_TEST_CONTROL_PERCENTAGE,
    featureFlagSource: {
      intelligentRouting: process.env.ENABLE_INTELLIGENT_ROUTING ? 'env' : 'default',
      activeRouting: process.env.ENABLE_ACTIVE_ROUTING ? 'env' : 'default',
      abTestControl: process.env.AB_TEST_CONTROL_PERCENTAGE ? 'env' : 'default',
    },
  };
}

/**
 * Exported for testing: Check if identifier is in control group.
 * @private
 */
export { isInControlGroup };
