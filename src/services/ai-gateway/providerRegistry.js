// ============================================================
// Provider Registry — capability → provider routing
// ============================================================
// Maps each CAPABILITY to its provider and method.
//
// ROUTING RULES:
//   - Copy generation → Claude (better at hooks/copy)
//   - Captions → OpenAI (better at conversational tone)
//   - Strategy → Claude (better at analysis)
//   - Visual prompts → OpenAI (optimized for DALL·E)
//   - Video prompts → Higgsfield
//
// SWAPPABLE:
//   Providers can be swapped per capability without changing
//   the runtime or executor code.
// ============================================================
import { CAPABILITY, PROVIDER } from './providerTypes.js';
import { claudeProvider, openaiProvider, higgsfieldProvider } from './providers/index.js';

export const PROVIDER_REGISTRY = Object.freeze({
  // Copy generation → Claude
  [CAPABILITY.GENERATE_HOOKS]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateHooks,
  },

  [CAPABILITY.GENERATE_COPY]: {
    provider: PROVIDER.CLAUDE,
    method: claudeProvider.generateCopy,
  },

  // Captions → OpenAI (better conversational tone)
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
