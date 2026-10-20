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
//     plan?: string,                   // plan-aware routing override (else resolved by workspaceId)
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
import { getProviderForCapability, getMethodForProvider } from './providerRegistry.js';
import { routeCapability } from './intelligentRouter.js'; // PR #38
import { ERROR_TYPE, CAPABILITY_FALLBACK, PROVIDER } from './providerTypes.js';
import { validateStructuredFeedback } from '../../types/feedbackTypes.js';
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const MAX_RETRIES = 3;
// Base backoff, env-driven so a deploy can tune rate-limit sensitivity (and tests
// can run instantly with 0). Default 1s preserves the original behaviour. With
// per-capability fallback, a request can now traverse TWO retry cycles (primary
// then fallback), so a tunable base matters more than before.
const RETRY_DELAY_MS = Number(process.env.AI_GATEWAY_RETRY_DELAY_MS ?? 1000);
const RETRYABLE_ERRORS = new Set([
  ERROR_TYPE.RATE_LIMIT,
  ERROR_TYPE.TIMEOUT,
  ERROR_TYPE.PROVIDER_ERROR,
]);

// Metering helper, loaded lazily and ONCE.
//
// Loading usage metering only on demand avoids importing DB-dependent code in
// callers that never record an AI attempt. Prisma now connects lazily on the
// first query, not at import. Memoized so concurrent callers share one module.
let usageModule = null;
function loadUsageRecorder() {
  usageModule ??= import('../../lib/aiUsage.js');
  return usageModule;
}

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

// ============================================================
// Plan-aware provider routing (opt-in via PLAN_AWARE_ROUTING_ENABLED)
// ------------------------------------------------------------
// Cost control: a FREE workspace is served by OpenAI (cheaper) and never billed
// to Claude. This is a THIN override on the resolved registration — it does NOT
// decide which capabilities a plan may use (that stays with requirePlan
// middleware); it only picks the cheaper provider for FREE. Off by default so a
// deploy opts in deliberately (mirrors the intelligentRouter feature flags).
//
// SAFETY — three corrections over a naive "FREE → OpenAI, else Claude":
//   1. Downgrade ONLY on an affirmative 'FREE'. Unknown/missing plan (and every
//      call while the flag is off) keeps the EXISTING per-capability routing —
//      the static registry is already OpenAI-primary for copy and Claude-primary
//      for reasoning, so we must never blanket-downgrade internal Claude calls.
//   2. Claude→OpenAI ONLY where OpenAI implements the capability. ANALYZE_CREATIVE,
//      RANK_VARIANTS, GENERATE_VISUAL_BRIEF and GENERATE_VIDEO_PROMPT have no
//      OpenAI method — they honestly keep their static provider (we cannot
//      fabricate one). Blocking them instead would be capability gating (not ours).
//   3. FREE suppresses the cross-provider fallback, so a FREE call can never spill
//      over to Claude (CAPABILITY_FALLBACK for copy points AT Claude).
// ============================================================
const PLAN_FREE = 'FREE';
const planAwareRoutingEnabled = () => process.env.PLAN_AWARE_ROUTING_ENABLED === 'true';

/**
 * Resolve the workspace plan for routing. An explicit `plan` wins (testable, and
 * lets a caller that already knows the plan skip the read); otherwise a
 * best-effort read by workspaceId. Never throws — a plan read must never block or
 * fail an AI call; an unknown plan simply means "no override".
 * @returns {Promise<string|null>} the plan, or null when unknown
 */
async function resolvePlan({ plan, workspaceId }) {
  if (plan) return plan;
  if (!workspaceId) return null;
  try {
    // Resolve a workspace plan on demand, not during gateway module import.
    // Prisma's first query is the deliberate DB operation; no eager $connect().
    const { prisma } = await import('../../lib/prisma.js');
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } });
    return ws?.plan ?? null;
  } catch {
    return null; // best-effort — unknown plan degrades to the existing routing
  }
}

/**
 * Apply the FREE-plan override to a resolved registration. A no-op for any plan
 * other than FREE (returns the registration untouched, fallback enabled).
 * @returns {{ provider: string, method: function, routingDecision: object, suppressFallback: boolean }}
 */
export function applyFreePlanRouting({ plan, capability, provider, method, routingDecision }) {
  if (plan !== PLAN_FREE) return { provider, method, routingDecision, suppressFallback: false };

  // FREE + Claude-primary: switch to OpenAI when it implements the capability.
  if (provider === PROVIDER.CLAUDE) {
    const oa = getMethodForProvider(PROVIDER.OPENAI, capability);
    if (oa) {
      return {
        provider: oa.provider,
        method: oa.method,
        routingDecision: {
          strategy: 'plan-free-downgrade',
          reason: `FREE plan → ${oa.provider} (static was ${provider})`,
          planDowngrade: true,
          staticProvider: provider,
        },
        suppressFallback: true, // FREE must never reach Claude via fallback
      };
    }
    // OpenAI can't serve this capability (ANALYZE_CREATIVE / RANK_VARIANTS /
    // GENERATE_VISUAL_BRIEF / GENERATE_VIDEO_PROMPT) — keep the static provider
    // honestly rather than fail. This is the documented "special routing override".
    return {
      provider,
      method,
      routingDecision: { ...routingDecision, planNote: `FREE plan but no OpenAI implementation for ${capability}; kept ${provider}` },
      suppressFallback: true,
    };
  }

  // FREE + already-OpenAI (copy) or Higgsfield (video): keep the provider, but
  // still suppress the fallback so a failed FREE call can't spill over to Claude.
  return { provider, method, routingDecision, suppressFallback: true };
}

/**
 * Run ONE provider method through the bounded retry loop and return the same
 * structured result the gateway always has (never throws). Extracted verbatim
 * from the original execute() loop so the primary path is byte-for-byte
 * unchanged; the gateway now calls it once for the primary provider and, on
 * failure, once more for a fallback provider.
 *
 * Also meters the sequence: ONE AiUsageLog row per call to this function, so a
 * request that exhausts the primary and then succeeds on the fallback writes
 * two rows — two providers were billed for one piece of work.
 *
 * @returns {Promise<{ success, output?, artifacts?, error?, metadata }>}
 */
async function runWithRetries({ method, input, decisionCtx, provider, requestId, capability, routingDecision, workspaceId }) {
  let attempt = 0;
  let lastError = null;

  // isFallback is TRUE only for a genuine cross-provider fallback. A retry
  // against the SAME provider is not a fallback, and `attempt > 1` would
  // conflate the two — making "we paid two providers for one request"
  // indistinguishable from "the first call timed out and the second worked".
  // The static-registry rescue path also sets routingDecision.fallback = true,
  // so the strategy name is the precise signal, not that flag.
  const isFallback = routingDecision?.strategy === 'fallback';

  // Fire-and-forget: metering must never add latency to, or fail, an AI call.
  // recordAiUsage already swallows everything; the .catch is for a mock or a
  // future caller that rejects, which would otherwise be an unhandled rejection.
  //
  const meter = (success, metadata) => {
    loadUsageRecorder()
      .then(({ recordAiUsage }) => recordAiUsage({
        workspaceId: workspaceId ?? null,
        capability,
        provider,
        model: metadata?.model ?? null,
        // null, not 0 — a failed call measured nothing, and providers may omit
        // usage entirely. The cost view must not render either as $0.00.
        inputTokens: metadata?.inputTokens ?? null,
        outputTokens: metadata?.outputTokens ?? null,
        tokens: metadata?.tokens ?? null,
        latencyMs: metadata?.latency ?? null,
        attempts: attempt,
        success,
        isFallback,
      }))
      .catch(() => {});
  };

  while (attempt < MAX_RETRIES) {
    attempt++;

    logger.debug({
      requestId, capability, provider, attempt,
      isReExecution: decisionCtx.isReExecution || false,
      hasFeedback: !!decisionCtx.feedback,
    }, '[ProviderGateway] calling provider');

    try {
      const result = await method(input, decisionCtx);

      if (result.success) {
        logger.info({
          requestId, capability, provider, attempt,
          tokens: result.metadata.tokens,
          latency: result.metadata.latency,
          routingStrategy: routingDecision?.strategy,
        }, '[ProviderGateway] capability executed successfully');

        meter(true, result.metadata);

        return {
          ...result,
          metadata: { ...result.metadata, provider, requestId, attempt, routingDecision },
        };
      }

      // Provider returned failure
      lastError = result.error;

      if (shouldRetry(lastError, attempt)) {
        const backoff = calculateBackoff(attempt);
        logger.warn({
          requestId, capability, provider, attempt, errorType: lastError.type, backoff,
        }, '[ProviderGateway] retrying after error');
        await sleep(backoff);
        continue;
      }

      logger.error({
        requestId, capability, provider, attempt,
        errorType: lastError.type, errorMessage: lastError.message,
      }, '[ProviderGateway] capability execution failed');

      // The provider's own metadata survives a failure — latency is real and
      // `model` is what the call targeted. Tokens are null by PR-A's contract.
      meter(false, result.metadata);

      return {
        success: false,
        error: lastError,
        metadata: { ...result.metadata, provider, requestId, attempt, routingDecision },
      };
    } catch (error) {
      // Unexpected error (should not happen if providers are implemented correctly)
      logger.error({
        requestId, capability, provider, attempt, error: error.message,
      }, '[ProviderGateway] unexpected error');

      lastError = { type: ERROR_TYPE.PROVIDER_ERROR, message: error.message };

      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        await sleep(backoff);
        continue;
      }

      // An unexpected throw left no provider metadata at all — record the
      // attempt with everything unknown rather than inventing a model or a
      // zero latency the caller never observed.
      meter(false, null);

      return {
        success: false,
        error: lastError,
        metadata: { provider, model: 'UNKNOWN', tokens: 0, latency: 0, requestId, attempt, routingDecision },
      };
    }
  }

  // Max retries exceeded
  meter(false, null);

  return {
    success: false,
    error: lastError || { type: ERROR_TYPE.PROVIDER_ERROR, message: 'Max retries exceeded' },
    metadata: { provider, model: 'UNKNOWN', tokens: 0, latency: 0, requestId, attempt: MAX_RETRIES, routingDecision },
  };
}

/**
 * Execute an AI capability through the appropriate provider.
 *
 * @param {{ capability: string, input: object, feedback?: string, revisionInstructions?: string, regenerationHint?: string, isReExecution?: boolean, feedbackType?: string, severity?: string, preserveAspects?: string[], workspaceId?: string, plan?: string }} request
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
    // Plan-aware routing: explicit plan override (else resolved by workspaceId).
    plan,
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

  // Plan-aware routing (opt-in). Off by default → effectivePlan stays null and
  // the registration is used exactly as resolved (zero behaviour change). When
  // enabled, a FREE workspace is served by OpenAI where possible, with the
  // cross-provider fallback suppressed so it can never reach Claude.
  const effectivePlan = planAwareRoutingEnabled()
    ? await resolvePlan({ plan, workspaceId })
    : null;
  const { provider, method, routingDecision, suppressFallback } = applyFreePlanRouting({
    plan: effectivePlan,
    capability,
    provider: registration.provider,
    method: registration.method,
    routingDecision: registration.routingDecision,
  });

  // 🔍 VERIFICATION LOG — Track which provider is actually being used
  logger.debug({
    provider,
    model: registration.model || 'UNKNOWN',
    capability,
    routingStrategy: routingDecision?.strategy || 'static',
    plan: effectivePlan || undefined,
  }, '[AI-GATEWAY] provider selected');

  // PR #32/#33: decision context passed to every provider call (primary + fallback).
  const decisionCtx = {
    feedback, revisionInstructions, regenerationHint, isReExecution,
    feedbackType, severity, preserveAspects,
  };

  // ── Primary provider (with bounded retries) ──
  const primaryResult = await runWithRetries({
    method, input, decisionCtx, provider, requestId, capability, routingDecision, workspaceId,
  });
  if (primaryResult.success) return primaryResult;

  // ── Cross-provider fallback ──
  // When the primary exhausts its retries, try the capability's configured
  // alternate provider — but ONLY if it's a DIFFERENT provider that actually
  // implements the capability. Capabilities with no fallback (or whose fallback
  // is the same provider / unimplemented) return the primary error unchanged.
  // Never throws, never fabricates: both-fail returns the honest primary error.
  // FREE plan suppresses the cross-provider fallback (it must never reach Claude).
  const fallbackProvider = CAPABILITY_FALLBACK[capability];
  if (!suppressFallback && fallbackProvider && fallbackProvider !== provider) {
    const fb = getMethodForProvider(fallbackProvider, capability);
    if (fb && typeof fb.method === 'function') {
      logger.warn({
        requestId, capability, primaryProvider: provider, fallbackProvider,
        primaryErrorType: primaryResult.error?.type,
      }, '[ProviderGateway] primary failed — attempting fallback provider');

      const fbResult = await runWithRetries({
        method: fb.method, input, decisionCtx, provider: fallbackProvider, requestId, capability, workspaceId,
        routingDecision: {
          strategy: 'fallback',
          reason: `Primary ${provider} failed (${primaryResult.error?.type || 'unknown'}); fell back to ${fallbackProvider}`,
          fallback: true,
          primaryProvider: provider,
        },
      });

      if (fbResult.success) {
        logger.info({
          requestId, capability, primaryProvider: provider, fallbackProvider,
        }, '[ProviderGateway] fallback provider succeeded');
        return {
          ...fbResult,
          metadata: {
            ...fbResult.metadata,
            fallbackUsed: true,
            primaryProvider: provider,
            primaryErrorType: primaryResult.error?.type,
          },
        };
      }

      logger.error({
        requestId, capability, primaryProvider: provider, fallbackProvider,
        primaryErrorType: primaryResult.error?.type,
        fallbackErrorType: fbResult.error?.type,
      }, '[ProviderGateway] both providers failed');
      return {
        ...primaryResult,
        metadata: {
          ...primaryResult.metadata,
          fallbackAttempted: true,
          fallbackProvider,
          fallbackErrorType: fbResult.error?.type,
        },
      };
    }
  }

  return primaryResult;
}
