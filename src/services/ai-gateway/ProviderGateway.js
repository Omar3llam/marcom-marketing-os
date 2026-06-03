// ============================================================
// Provider Gateway — main AI coordination layer
// ============================================================
// Single public API: execute({ capability, input })
//
// ISOLATION CONTRACT:
//   Executors never call AI APIs directly.
//   All AI calls route through this gateway.
//
// DETERMINISM PRESERVATION:
//   - Request IDs are deterministic (hash of input)
//   - Retries are bounded (max 3)
//   - Failures are classified (structured errors)
//   - Timeouts are enforced
//   - Artifacts are append-only
//
// INPUT:
//   {
//     capability: CAPABILITY enum,
//     input: { ...capability-specific data },
//     feedback?: string,              // PR #32: reviewer feedback
//     revisionInstructions?: string,   // PR #32: revision instructions
//     regenerationHint?: string,       // PR #32: regeneration hint
//     isReExecution?: boolean,         // PR #32: re-execution flag
//     feedbackType?: string,           // PR #33: structured feedback type
//     severity?: string,               // PR #33: feedback severity (LOW/MEDIUM/HIGH)
//     preserveAspects?: string[],      // PR #33: aspects to preserve during regen
//     workspaceId?: string,            // PR #38: for workspace-scoped provider routing
//   }
//
// OUTPUT:
//   {
//     success: boolean,
//     output: {...},
//     artifacts: [...],
//     metadata: {
//       provider,
//       model,
//       tokens,
//       latency,
//       routingDecision // PR #38: how provider was selected
//     },
//     error?: { type, message }
//   }
// ============================================================
import { getProviderForCapability } from './providerRegistry.js';
import { routeCapability } from './intelligentRouter.js'; // PR #38
import { ERROR_TYPE } from './providerTypes.js';
import { validateStructuredFeedback } from '../../types/feedbackTypes.js';
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1s base delay
const RETRYABLE_ERRORS = new Set([
  ERROR_TYPE.RATE_LIMIT,
  ERROR_TYPE.TIMEOUT,
  ERROR_TYPE.PROVIDER_ERROR,
]);

function generateRequestId(capability, input) {
  const payload = JSON.stringify({ capability, input });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(error, attempt) {
  if (attempt >= MAX_RETRIES) {
    return false;
  }

  if (!error || !error.type) {
    return false;
  }

  return RETRYABLE_ERRORS.has(error.type);
}

function calculateBackoff(attempt) {
  return RETRY_DELAY_MS * Math.pow(2, attempt - 1);
}

/**
 * Execute an AI capability through the appropriate provider.
 *
 * @param {{ capability: string, input: object, feedback?: string, revisionInstructions?: string, regenerationHint?: string, isReExecution?: boolean, feedbackType?: string, severity?: string, preserveAspects?: string[], workspaceId?: string }} request
 * @returns {Promise<{ success: boolean, output?: object, artifacts?: array, metadata: object, error?: object }>}
 */
export async function execute(request) {
  const {
    capability,
    input,
    feedback,
    revisionInstructions,
    regenerationHint,
    isReExecution,
    // PR #33: Structured feedback
    feedbackType,
    severity,
    preserveAspects,
    // PR #38: Intelligent routing
    workspaceId,
  } = request;

  if (!capability) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.VALIDATION_ERROR,
        message: 'capability is required',
      },
      metadata: {
        provider: 'UNKNOWN',
        model: 'UNKNOWN',
        tokens: 0,
        latency: 0,
      },
    };
  }

  if (!input || typeof input !== 'object') {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.VALIDATION_ERROR,
        message: 'input must be a non-null object',
      },
      metadata: {
        provider: 'UNKNOWN',
        model: 'UNKNOWN',
        tokens: 0,
        latency: 0,
      },
    };
  }

  // PR #33: Validate structured feedback if present (defense-in-depth)
  if (feedbackType || severity || preserveAspects) {
    const validation = validateStructuredFeedback({ feedbackType, severity, preserveAspects });
    if (!validation.valid) {
      return {
        success: false,
        error: {
          type: ERROR_TYPE.VALIDATION_ERROR,
          message: `Invalid structured feedback: ${validation.errors.join(', ')}`,
        },
        metadata: {
          provider: 'UNKNOWN',
          model: 'UNKNOWN',
          tokens: 0,
          latency: 0,
        },
      };
    }
  }

  const requestId = generateRequestId(capability, input);

  logger.debug({
    requestId,
    capability,
    workspaceId,
  }, '[ProviderGateway] executing capability');

  // PR #38: Use intelligent routing to select provider
  let registration;
  try {
    registration = await routeCapability(capability, {
      workspaceId,
      enableIntelligentRouting: true, // Always try intelligent routing, fallback handled internally
    });
  } catch (error) {
    // Fallback to static registry if routing fails
    logger.warn({
      requestId,
      capability,
      error: error.message,
    }, '[ProviderGateway] routing failed, falling back to static registry');

    try {
      registration = getProviderForCapability(capability);
      registration.routingDecision = {
        strategy: 'static',
        reason: `Routing error: ${error.message}`,
        fallback: true,
      };
    } catch (fallbackError) {
      return {
        success: false,
        error: {
          type: ERROR_TYPE.VALIDATION_ERROR,
          message: fallbackError.message,
        },
        metadata: {
          provider: 'UNKNOWN',
          model: 'UNKNOWN',
          tokens: 0,
          latency: 0,
        },
      };
    }
  }

  const { provider, method, routingDecision } = registration;

  // 🔍 VERIFICATION LOG — Track which provider is actually being used
  console.log('[AI-GATEWAY]', {
    provider,
    model: registration.model || 'UNKNOWN',
    capability,
    routingStrategy: routingDecision?.strategy || 'static',
  });

  // Execute with retries
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_RETRIES) {
    attempt++;

    logger.debug({
      requestId,
      capability,
      provider,
      attempt,
      isReExecution: isReExecution || false,
      hasFeedback: !!feedback,
    }, '[ProviderGateway] calling provider');

    try {
      // PR #32: Pass decision context to provider
      const result = await method(input, {
        feedback,
        revisionInstructions,
        regenerationHint,
        isReExecution,
        // PR #33: Pass structured feedback
        feedbackType,
        severity,
        preserveAspects,
      });

      if (result.success) {
        logger.info({
          requestId,
          capability,
          provider,
          attempt,
          tokens: result.metadata.tokens,
          latency: result.metadata.latency,
          routingStrategy: routingDecision?.strategy, // PR #38
        }, '[ProviderGateway] capability executed successfully');

        return {
          ...result,
          metadata: {
            ...result.metadata,
            provider,
            requestId,
            attempt,
            routingDecision, // PR #38: include routing decision in metadata
          },
        };
      }

      // Provider returned failure
      lastError = result.error;

      if (shouldRetry(lastError, attempt)) {
        const backoff = calculateBackoff(attempt);
        logger.warn({
          requestId,
          capability,
          provider,
          attempt,
          errorType: lastError.type,
          backoff,
        }, '[ProviderGateway] retrying after error');

        await sleep(backoff);
        continue;
      }

      // Non-retryable error or max retries reached
      logger.error({
        requestId,
        capability,
        provider,
        attempt,
        errorType: lastError.type,
        errorMessage: lastError.message,
      }, '[ProviderGateway] capability execution failed');

      return {
        success: false,
        error: lastError,
        metadata: {
          ...result.metadata,
          provider,
          requestId,
          attempt,
          routingDecision, // PR #38
        },
      };
    } catch (error) {
      // Unexpected error (should not happen if providers are implemented correctly)
      logger.error({
        requestId,
        capability,
        provider,
        attempt,
        error: error.message,
      }, '[ProviderGateway] unexpected error');

      lastError = {
        type: ERROR_TYPE.PROVIDER_ERROR,
        message: error.message,
      };

      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        await sleep(backoff);
        continue;
      }

      return {
        success: false,
        error: lastError,
        metadata: {
          provider,
          model: 'UNKNOWN',
          tokens: 0,
          latency: 0,
          requestId,
          attempt,
          routingDecision, // PR #38
        },
      };
    }
  }

  // Max retries exceeded
  return {
    success: false,
    error: lastError || {
      type: ERROR_TYPE.PROVIDER_ERROR,
      message: 'Max retries exceeded',
    },
    metadata: {
      provider,
      model: 'UNKNOWN',
      tokens: 0,
      latency: 0,
      requestId,
      attempt: MAX_RETRIES,
      routingDecision, // PR #38
    },
  };
}
