// ============================================================
// Intelligent Provider Router — PR #38
// ============================================================
// Routes AI capabilities to providers based on approval analytics
// performance data, with fallback to static registry.
//
// USAGE:
//   const registration = await routeCapability('GENERATE_HOOKS', {
//     workspaceId: 'ws-123',
//     enableIntelligentRouting: true
//   });
//   // Returns { provider, method, routingDecision }
//
// ROUTING STRATEGY:
//   1. If intelligent routing enabled AND performance data exists:
//      → Use best-performing provider from analytics
//   2. Else:
//      → Fallback to static PROVIDER_REGISTRY
//
// FEATURE FLAG:
//   Set ENABLE_INTELLIGENT_ROUTING=true in .env to enable
// ============================================================
import { getProviderForCapability } from './providerRegistry.js';
import { getBestProvider } from './providerPerformance.js';
import { logger } from '../../utils/logger.js';

// Feature flag (default: false for safety, enable via env)
const INTELLIGENT_ROUTING_ENABLED = process.env.ENABLE_INTELLIGENT_ROUTING === 'true';

/**
 * Route a capability to the best-performing provider.
 *
 * @param {string} capability - The capability to route
 * @param {object} options - Routing options
 * @param {string} options.workspaceId - Workspace ID for workspace-scoped routing (optional)
 * @param {boolean} options.enableIntelligentRouting - Override feature flag (optional)
 * @param {object} options.performanceOptions - Options to pass to performance scorer (optional)
 * @returns {Promise<{ provider: string, method: function, routingDecision: object }>}
 */
export async function routeCapability(capability, options = {}) {
  const {
    workspaceId = null,
    enableIntelligentRouting = INTELLIGENT_ROUTING_ENABLED,
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

  // Get the provider method from registry
  // The static registry maps provider name to method, but we need to look it up
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

  // Analytics suggests a different provider than static registry
  // For PR #38, we'll LOG this but still use static registry for safety
  // Future PR can add provider override capability
  logger.info({
    capability,
    staticProvider: staticRegistration.provider,
    analyticsProvider,
    approvalRate: bestProvider.score.approvalRate,
    total: bestProvider.score.total,
  }, '[intelligentRouter] analytics suggests different provider (not overriding yet)');

  return {
    ...staticRegistration,
    routingDecision: {
      strategy: 'performance-based-passive',
      reason: `Static registry provider: ${staticRegistration.provider}. Analytics suggests: ${analyticsProvider} (${bestProvider.reason}) — logged for observation`,
      fallback: false,
      performanceData: bestProvider.score,
      analyticsRecommendation: analyticsProvider,
    },
  };
}

/**
 * Get routing statistics for observability.
 * Returns how often intelligent routing is used vs fallback.
 *
 * @returns {object} Routing statistics
 */
export function getRoutingStats() {
  return {
    intelligentRoutingEnabled: INTELLIGENT_ROUTING_ENABLED,
    featureFlagSource: process.env.ENABLE_INTELLIGENT_ROUTING ? 'env' : 'default',
  };
}
