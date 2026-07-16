// ============================================================
// AI Provider Gateway — type definitions
// ============================================================
// Frozen enums for capabilities, providers, and error types.
//
// CAPABILITY: What the runtime needs (e.g., "GENERATE_HOOKS")
// PROVIDER: Who provides it (e.g., "CLAUDE", "OPENAI")
// ERROR_TYPE: Structured failure classification
// ============================================================

export const CAPABILITY = Object.freeze({
  // Copy generation
  GENERATE_HOOKS:    'GENERATE_HOOKS',
  GENERATE_CAPTIONS: 'GENERATE_CAPTIONS',
  GENERATE_COPY:     'GENERATE_COPY',

  // Strategy & analysis
  GENERATE_STRATEGY:       'GENERATE_STRATEGY',
  GENERATE_AUDIENCE:       'GENERATE_AUDIENCE',
  ANALYZE_CREATIVE:        'ANALYZE_CREATIVE',
  EXPLAIN_VERDICT:         'EXPLAIN_VERDICT', // on-demand prose reasoning for a campaign verdict
  ANALYZE_PORTFOLIO:       'ANALYZE_PORTFOLIO', // ADVISORY account-level narration (never assigns verdicts)
  ANSWER_QUESTION:         'ANSWER_QUESTION', // account-aware Q&A for the Copilot chat

  // Visual & multimedia
  GENERATE_VISUAL_BRIEF:   'GENERATE_VISUAL_BRIEF',
  GENERATE_VISUAL_PROMPT:  'GENERATE_VISUAL_PROMPT',
  GENERATE_VIDEO_PROMPT:   'GENERATE_VIDEO_PROMPT',

  // Validation & scoring
  VALIDATE_CONTENT: 'VALIDATE_CONTENT',
  RANK_VARIANTS:    'RANK_VARIANTS',
});

export const PROVIDER = Object.freeze({
  CLAUDE:     'CLAUDE',
  OPENAI:     'OPENAI',
  HIGGSFIELD: 'HIGGSFIELD',
  GEMINI:     'GEMINI',      // future
  DALLE:      'DALLE',        // future
});

export const ERROR_TYPE = Object.freeze({
  RATE_LIMIT:        'RATE_LIMIT',
  TIMEOUT:           'TIMEOUT',
  INVALID_RESPONSE:  'INVALID_RESPONSE',
  AUTH_ERROR:        'AUTH_ERROR',
  PROVIDER_ERROR:    'PROVIDER_ERROR',
  VALIDATION_ERROR:  'VALIDATION_ERROR',
});

// ============================================================
// Per-capability cross-provider fallback
// ============================================================
// When a capability's PRIMARY provider (from providerRegistry) fails after its
// retries, the gateway attempts the provider named here — but ONLY if that
// provider actually implements the capability (getMethodForProvider resolves a
// method). Capabilities absent from this map have NO fallback (quality-critical
// or single-implementation): ANALYZE_CREATIVE, RANK_VARIANTS, GENERATE_VISUAL_BRIEF,
// GENERATE_VISUAL_PROMPT, GENERATE_VIDEO_PROMPT. The value is the *alternate*
// provider, so it is the OTHER provider from the static primary.
export const CAPABILITY_FALLBACK = Object.freeze({
  // OpenAI-primary copy → Claude fallback (both already implemented).
  [CAPABILITY.GENERATE_COPY]:     PROVIDER.CLAUDE,
  [CAPABILITY.GENERATE_HOOKS]:    PROVIDER.CLAUDE,
  [CAPABILITY.GENERATE_CAPTIONS]: PROVIDER.CLAUDE,
  // Claude-primary reasoning → OpenAI fallback (OpenAI methods added alongside
  // this map; each mirrors the Claude method's prompt + output shape exactly).
  [CAPABILITY.EXPLAIN_VERDICT]:    PROVIDER.OPENAI,
  [CAPABILITY.ANALYZE_PORTFOLIO]:  PROVIDER.OPENAI,
  [CAPABILITY.ANSWER_QUESTION]:    PROVIDER.OPENAI,
  [CAPABILITY.GENERATE_STRATEGY]: PROVIDER.OPENAI,
  [CAPABILITY.GENERATE_AUDIENCE]: PROVIDER.OPENAI,
  [CAPABILITY.VALIDATE_CONTENT]:  PROVIDER.OPENAI,
});

export const MODEL = Object.freeze({
  // Claude — IDs use dashes, never dots. The prior value 'claude-sonnet-4.5-20250514'
  // was invalid two ways (a dot in '4.5', and a Sonnet-4 date pinned to a "4.5"
  // name) so the Anthropic API 404'd it — silently breaking EVERY Claude gateway
  // capability (strategy, audience, validation, visual brief, verdict reasoning).
  CLAUDE_SONNET_4:  'claude-sonnet-4-5',
  CLAUDE_OPUS_4:    'claude-opus-4-20250514',

  // OpenAI
  GPT_4O:           'gpt-4o',
  GPT_4O_MINI:      'gpt-4o-mini',
  O1:               'o1',

  // Higgsfield
  HIGGSFIELD_V1:    'higgsfield-v1',
});
