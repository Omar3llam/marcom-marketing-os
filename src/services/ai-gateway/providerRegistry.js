// ============================================================
// Provider Registry — capability → provider routing
// ============================================================
// Maps each CAPABILITY to its provider and method.
//
// ROUTING RULES:
//   - Copy generation → OpenAI GPT-4o-mini (70% cheaper, good quality)
//   - Captions → OpenAI GPT-4o-mini (better at conversational tone)
//   - Strategy → Claude (better at analysis)
//   - Visual prompts → OpenAI GPT-4o-mini (optimized for DALL·E)
//   - Video prompts → Higgsfield
//
// SWAPPABLE:
//   Providers can be swapped per capability without changing
//   the runtime or executor code.
// ============================================================
import { CAPABILITY, PROVIDER } from './providerTypes.js';
import { claudeProvider, openaiProvider, higgsfieldProvider } from './providers/index.js';

export const PROVIDER_REGISTRY = Object.freeze({
  // Copy generation → OpenAI GPT-4o-mini (70% cheaper than Claude)
  [CAPABILITY.GENERATE_HOOKS]: {
    provider: PROVIDER.OPENAI,
    method: openaiProvider.generateHooks,
  },

  [CAPABILITY.GENERATE_COPY]: {
    provider: PROVIDER.OPENAI,
    method: openaiProvider.generateCopy,
  },

  // Captions → OpenAI (better conversational tone + cheaper with GPT-4o-mini)
  [CAPABILITY.GENERATE_CAPTIONS]: {
    provider: PROVIDER.OPENAI,
    method: openaiProvider.generateCaptions,
  },

  // Strategy → Claude (better at analysis)
  [CAPABILITY.GENERATE_STRATEGY]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateAngleVariants,
  },

  [CAPABILITY.GENERATE_AUDIENCE]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateAudienceHypotheses,
  },

  [CAPABILITY.ANALYZE_CREATIVE]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.validateContent,
  },

  // Verdict reasoning → Claude (best at analysis; prose output, not JSON)
  [CAPABILITY.EXPLAIN_VERDICT]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.explainVerdict,
  },

  // Portfolio briefing → Claude (1-2 sentence summary)
  [CAPABILITY.GENERATE_BRIEFING]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateBriefing,
  },

  // Copilot Q&A → Claude (account-aware prose answer)
  [CAPABILITY.ANSWER_QUESTION]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.answerQuestion,
  },

  // Visual → Claude for brief, OpenAI for prompt
  [CAPABILITY.GENERATE_VISUAL_BRIEF]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateVisualBrief,
  },

  [CAPABILITY.GENERATE_VISUAL_PROMPT]: {
    provider: PROVIDER.OPENAI,
    method: openaiProvider.generateVisualPrompt,
  },

  [CAPABILITY.GENERATE_VIDEO_PROMPT]: {
    provider: PROVIDER.HIGGSFIELD,
    method: higgsfieldProvider.generateVideoPrompt,
  },

  // Validation & ranking → Claude
  [CAPABILITY.VALIDATE_CONTENT]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.validateContent,
  },

  [CAPABILITY.RANK_VARIANTS]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.rankVariants,
  },
});

export function getProviderForCapability(capability) {
  const registration = PROVIDER_REGISTRY[capability];
  if (!registration) {
    throw new Error(`Unknown capability: ${capability}`);
  }
  return registration;
}

// ============================================================
// PR #39 — Provider Method Lookup
// ============================================================
// Maps (provider, capability) → method for active routing.
// Allows switching providers when analytics recommends different provider.
//
// USAGE:
//   const method = getMethodForProvider('CLAUDE', 'GENERATE_CAPTIONS');
//   const result = await method(input);
// ============================================================

const PROVIDER_METHOD_MAP = Object.freeze({
  [PROVIDER.CLAUDE]: {
    [CAPABILITY.GENERATE_HOOKS]: claudeProvider.generateHooks,
    [CAPABILITY.GENERATE_COPY]: claudeProvider.generateCopy,
    [CAPABILITY.GENERATE_CAPTIONS]: claudeProvider.generateCaptions,
    [CAPABILITY.GENERATE_AUDIENCE]: claudeProvider.generateAudienceHypotheses,
    [CAPABILITY.GENERATE_STRATEGY]: claudeProvider.generateAngleVariants,
    [CAPABILITY.ANALYZE_CREATIVE]: claudeProvider.validateContent,
    [CAPABILITY.EXPLAIN_VERDICT]: claudeProvider.explainVerdict,
    [CAPABILITY.GENERATE_BRIEFING]: claudeProvider.generateBriefing,
    [CAPABILITY.ANSWER_QUESTION]: claudeProvider.answerQuestion,
    [CAPABILITY.VALIDATE_CONTENT]: claudeProvider.validateContent,
    [CAPABILITY.RANK_VARIANTS]: claudeProvider.rankVariants,
    [CAPABILITY.GENERATE_VISUAL_BRIEF]: claudeProvider.generateVisualBrief,
  },
  [PROVIDER.OPENAI]: {
    [CAPABILITY.GENERATE_HOOKS]: openaiProvider.generateHooks,
    [CAPABILITY.GENERATE_COPY]: openaiProvider.generateCopy,
    [CAPABILITY.GENERATE_CAPTIONS]: openaiProvider.generateCaptions,
    [CAPABILITY.GENERATE_VISUAL_PROMPT]: openaiProvider.generateVisualPrompt,
    // Fallback targets for Claude-primary capabilities (PR: gateway fallback).
    [CAPABILITY.GENERATE_STRATEGY]: openaiProvider.generateAngleVariants,
    [CAPABILITY.GENERATE_AUDIENCE]: openaiProvider.generateAudienceHypotheses,
    [CAPABILITY.VALIDATE_CONTENT]: openaiProvider.validateContent,
    [CAPABILITY.EXPLAIN_VERDICT]: openaiProvider.explainVerdict,
    [CAPABILITY.GENERATE_BRIEFING]: openaiProvider.generateBriefing,
    [CAPABILITY.ANSWER_QUESTION]: openaiProvider.answerQuestion,
  },
  [PROVIDER.HIGGSFIELD]: {
    [CAPABILITY.GENERATE_VIDEO_PROMPT]: higgsfieldProvider.generateVideoPrompt,
  },
});

/**
 * Get provider method for a given (provider, capability) pair.
 * Used for active routing when analytics recommends different provider.
 *
 * @param {string} provider - Provider name (e.g., 'CLAUDE', 'OPENAI')
 * @param {string} capability - Capability name (e.g., 'GENERATE_HOOKS')
 * @returns {{ provider: string, method: function } | null} Registration or null if not supported
 */
export function getMethodForProvider(provider, capability) {
  const providerMethods = PROVIDER_METHOD_MAP[provider];
  if (!providerMethods) {
    return null; // Provider not found
  }

  const method = providerMethods[capability];
  if (!method) {
    return null; // Provider doesn't support this capability
  }

  return {
    provider,
    method,
  };
}
