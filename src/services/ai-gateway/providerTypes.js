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
  GENERATE_BRIEFING:       'GENERATE_BRIEFING', // 1-2 sentence portfolio state summary
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
