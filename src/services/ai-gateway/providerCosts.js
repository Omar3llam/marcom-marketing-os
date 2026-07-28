// ============================================================
// Provider Cost Data — PR #40
// ============================================================
// Cost metadata for AI providers to enable cost-quality optimization.
//
// PRICING STRUCTURE:
//   - Input tokens: cost per 1M tokens
//   - Output tokens: cost per 1M tokens
//   - Pricing as of May 2026 (update quarterly)
//
// USAGE:
//   const cost = getProviderCost('CLAUDE', 'GENERATE_HOOKS');
//   const totalCost = calculateExecutionCost(usage);
// ============================================================

import { PROVIDER, MODEL } from './providerTypes.js';

// Cost per 1M tokens (USD) — updated May 2026
export const PROVIDER_PRICING = Object.freeze({
  [PROVIDER.CLAUDE]: {
    [MODEL.CLAUDE_SONNET_4]: {
      inputCostPer1M: 3.00,   // $3 per 1M input tokens
      outputCostPer1M: 15.00, // $15 per 1M output tokens
      avgTokensPerRequest: {
        GENERATE_HOOKS: { input: 2500, output: 800 },
        GENERATE_CAPTIONS: { input: 2000, output: 600 },
        GENERATE_COPY: { input: 3000, output: 1000 },
        GENERATE_STRATEGY: { input: 3500, output: 1200 },
        GENERATE_AUDIENCE: { input: 3000, output: 1000 },
        ANALYZE_CREATIVE: { input: 2500, output: 800 },
        VALIDATE_CONTENT: { input: 2000, output: 500 },
        RANK_VARIANTS: { input: 2500, output: 600 },
        GENERATE_VISUAL_BRIEF: { input: 2500, output: 800 },
      },
    },
    [MODEL.CLAUDE_OPUS_4]: {
      inputCostPer1M: 15.00,  // $15 per 1M input tokens
      outputCostPer1M: 75.00, // $75 per 1M output tokens
      avgTokensPerRequest: {
        GENERATE_HOOKS: { input: 2500, output: 800 },
        GENERATE_CAPTIONS: { input: 2000, output: 600 },
        GENERATE_COPY: { input: 3000, output: 1000 },
        GENERATE_STRATEGY: { input: 3500, output: 1200 },
        GENERATE_AUDIENCE: { input: 3000, output: 1000 },
        ANALYZE_CREATIVE: { input: 2500, output: 800 },
        VALIDATE_CONTENT: { input: 2000, output: 500 },
        RANK_VARIANTS: { input: 2500, output: 600 },
        GENERATE_VISUAL_BRIEF: { input: 2500, output: 800 },
      },
    },
  },

  [PROVIDER.OPENAI]: {
    [MODEL.GPT_4O]: {
      inputCostPer1M: 2.50,   // $2.50 per 1M input tokens
      outputCostPer1M: 10.00, // $10 per 1M output tokens
      avgTokensPerRequest: {
        GENERATE_CAPTIONS: { input: 1800, output: 500 },
        GENERATE_VISUAL_PROMPT: { input: 2000, output: 600 },
      },
    },
    [MODEL.GPT_4O_MINI]: {
      inputCostPer1M: 0.15,   // $0.15 per 1M input tokens
      outputCostPer1M: 0.60,  // $0.60 per 1M output tokens
      avgTokensPerRequest: {
        GENERATE_CAPTIONS: { input: 1800, output: 500 },
        GENERATE_VISUAL_PROMPT: { input: 2000, output: 600 },
      },
    },
  },

  [PROVIDER.HIGGSFIELD]: {
    [MODEL.HIGGSFIELD_V1]: {
      inputCostPer1M: 5.00,   // $5 per 1M input tokens
      outputCostPer1M: 20.00, // $20 per 1M output tokens
      avgTokensPerRequest: {
        GENERATE_VIDEO_PROMPT: { input: 2500, output: 800 },
      },
    },
  },
});

// Default model per provider (used when model not specified)
export const DEFAULT_PROVIDER_MODELS = Object.freeze({
  [PROVIDER.CLAUDE]: MODEL.CLAUDE_SONNET_4,
  [PROVIDER.OPENAI]: MODEL.GPT_4O,
  [PROVIDER.HIGGSFIELD]: MODEL.HIGGSFIELD_V1,
});

// The date PROVIDER_PRICING was last verified. Surfaced to the operator so an
// estimate is never mistaken for a bill — rates change and this table does not
// update itself.
export const PRICING_AS_OF = '2026-05';

/**
 * Per-million-token rates for a provider/model pair, for METERED usage.
 *
 * Deliberately NOT getProviderCost(): that function gates on the capability
 * appearing in `avgTokensPerRequest`, which covers only 9 of the 13
 * capabilities — so EXPLAIN_VERDICT, ANALYZE_PORTFOLIO and ANSWER_QUESTION
 * would return null even when real token counts are in hand. The averages are
 * for FORECASTING an unmade call; they have nothing to do with pricing one that
 * already happened.
 *
 * Model ids are matched by longest prefix because providers return DATED ids
 * ('gpt-4o-2024-08-06', 'claude-sonnet-4-5-20250929') that no table can
 * enumerate. Longest-first is load-bearing: 'gpt-4o' is a prefix of
 * 'gpt-4o-mini', and matching it first would price mini calls at 16x their
 * real rate.
 *
 * Unlike getProviderCost, an ABSENT model does NOT fall back to the provider
 * default. Defaulting is right for forecasting a call that has not happened; it
 * is wrong for pricing one that has. CLAUDE defaults to Sonnet, so a real Opus
 * call whose model went unreported would be costed at a fifth of its true rate
 * — a wrong number, indistinguishable from a right one.
 *
 * @param {string} provider
 * @param {string|null} model - the id the API returned
 * @returns {{ inputCostPer1M: number, outputCostPer1M: number, matchedModel: string } | null}
 *          null when the provider, the model, or the pricing is unknown — an
 *          unknown model must cost NOTHING rather than a plausible default.
 */
export function getModelRates(provider, model) {
  const providerData = PROVIDER_PRICING[provider];
  if (!providerData || !model) return null;

  const candidates = Object.keys(providerData).sort((a, b) => b.length - a.length);
  const key = candidates.find((m) => model === m || model.startsWith(m));

  const modelData = key ? providerData[key] : null;
  if (!modelData) return null;

  return {
    inputCostPer1M: modelData.inputCostPer1M,
    outputCostPer1M: modelData.outputCostPer1M,
    matchedModel: key,
  };
}

/**
 * Cost in USD for a metered call, from REAL token counts.
 *
 * Returns null — never 0 — when either side is unreported or the model is
 * unpriced. A dashboard that renders an unmeasured call as $0.00 is stating a
 * falsehood, which is the failure this whole track exists to avoid.
 *
 * @returns {number|null}
 */
export function costFromTokens(provider, model, inputTokens, outputTokens) {
  if (inputTokens == null || outputTokens == null) return null;

  const rates = getModelRates(provider, model);
  if (!rates) return null;

  return (
    (inputTokens / 1_000_000) * rates.inputCostPer1M +
    (outputTokens / 1_000_000) * rates.outputCostPer1M
  );
}

/**
 * Get cost data for a provider/capability pair.
 *
 * @param {string} provider - Provider name (e.g., 'CLAUDE')
 * @param {string} capability - Capability name (e.g., 'GENERATE_HOOKS')
 * @param {string} model - Model name (optional, defaults to provider default)
 * @returns {{ inputCostPer1M: number, outputCostPer1M: number, avgTokens: object } | null}
 */
export function getProviderCost(provider, capability, model = null) {
  const selectedModel = model || DEFAULT_PROVIDER_MODELS[provider];
  const providerData = PROVIDER_PRICING[provider];

  if (!providerData) {
    return null; // Provider not found
  }

  const modelData = providerData[selectedModel];
  if (!modelData) {
    return null; // Model not found
  }

  const avgTokens = modelData.avgTokensPerRequest[capability];
  if (!avgTokens) {
    return null; // Capability not supported or no cost data
  }

  return {
    inputCostPer1M: modelData.inputCostPer1M,
    outputCostPer1M: modelData.outputCostPer1M,
    avgTokens,
  };
}

/**
 * Calculate estimated cost for a single execution.
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {object} tokenUsage - Token usage (optional, uses averages if not provided)
 * @param {number} tokenUsage.inputTokens - Actual input tokens (optional)
 * @param {number} tokenUsage.outputTokens - Actual output tokens (optional)
 * @param {string} model - Model name (optional)
 * @returns {number | null} Cost in USD, or null if no cost data
 */
export function calculateExecutionCost(provider, capability, tokenUsage = null, model = null) {
  const costData = getProviderCost(provider, capability, model);
  if (!costData) {
    return null;
  }

  const inputTokens = tokenUsage?.inputTokens || costData.avgTokens.input;
  const outputTokens = tokenUsage?.outputTokens || costData.avgTokens.output;

  const inputCost = (inputTokens / 1_000_000) * costData.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * costData.outputCostPer1M;

  return inputCost + outputCost;
}

/**
 * Calculate cost-per-approval metric for a provider.
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {number} approvalRate - Approval rate as percentage (0-100)
 * @param {string} model - Model name (optional)
 * @returns {number | null} Cost per approved artifact in USD, or null if no cost data
 */
export function calculateCostPerApproval(provider, capability, approvalRate, model = null) {
  const executionCost = calculateExecutionCost(provider, capability, null, model);
  if (executionCost === null || approvalRate === 0) {
    return null;
  }

  // If approval rate is 50%, you need 2 executions on average to get 1 approval
  // Cost per approval = execution cost / (approval rate as decimal)
  return executionCost / (approvalRate / 100);
}
