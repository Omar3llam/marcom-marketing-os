// ============================================================
// AI Gateway — canonical provider response fixtures
// ============================================================
// Frozen response examples for testing provider integrations.
// These define the expected response shapes for each capability.
// ============================================================
import { CAPABILITY, PROVIDER, ERROR_TYPE } from '../providerTypes.js';

export const MOCK_RESPONSES = Object.freeze({
  [CAPABILITY.GENERATE_HOOKS]: {
    success: true,
    output: {
      hooks: [
        { hook: 'Stop wasting money on ads that do not convert', angle: 'problem', rationale: 'Addresses pain point' },
        { hook: '3X your ROAS in 30 days without guesswork', angle: 'benefit', rationale: 'Clear value prop' },
        { hook: 'The Meta ads secret nobody talks about', angle: 'curiosity', rationale: 'Scroll-stopping' },
      ],
      count: 3,
    },
    artifacts: [
      { type: 'hook', id: 'hook_0', content: 'Stop wasting money on ads that do not convert', angle: 'problem' },
      { type: 'hook', id: 'hook_1', content: '3X your ROAS in 30 days without guesswork', angle: 'benefit' },
      { type: 'hook', id: 'hook_2', content: 'The Meta ads secret nobody talks about', angle: 'curiosity' },
    ],
    metadata: {
      provider: PROVIDER.CLAUDE,
      model: 'claude-sonnet-4.5-20250514',
      tokens: 512,
      latency: 1200,
    },
  },

  [CAPABILITY.GENERATE_CAPTIONS]: {
    success: true,
    output: {
      captions: [
        { caption: 'Your current ad strategy is bleeding money. Here is how to fix it in 48 hours.', cta: 'Learn More', tone: 'urgent', rationale: 'Direct + actionable' },
        { caption: 'We helped 500+ brands turn failing campaigns into winners. Your turn.', cta: 'Get Started', tone: 'relatable', rationale: 'Social proof + aspiration' },
      ],
      count: 2,
    },
    artifacts: [
      { type: 'caption', id: 'caption_0', content: 'Your current ad strategy is bleeding money. Here is how to fix it in 48 hours.', tone: 'urgent' },
      { type: 'caption', id: 'caption_1', content: 'We helped 500+ brands turn failing campaigns into winners. Your turn.', tone: 'relatable' },
    ],
    metadata: {
      provider: PROVIDER.OPENAI,
      model: 'gpt-4o',
      tokens: 384,
      latency: 980,
    },
  },

  [CAPABILITY.GENERATE_VISUAL_BRIEF]: {
    success: true,
    output: {
      concept: 'Split-screen comparison: cluttered dashboard vs. clean LUMI interface, subtle animation showing data transforming into actionable insights',
      colorPalette: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F7F7F7', '#2C3E50'],
      composition: 'Mobile-first vertical split (60/40), problem on left (desaturated), solution on right (vibrant)',
      typography: 'Sans-serif, bold headline, minimal body copy',
      mobileOptimization: '9:16 aspect ratio, readable at thumbnail size, CTA in bottom third',
      rationale: 'Problem-solution contrast creates immediate visual tension, driving engagement',
    },
    artifacts: [{
      type: 'visual_brief',
      id: 'brief',
      content: {
        concept: 'Split-screen comparison: cluttered dashboard vs. clean LUMI interface',
        colorPalette: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F7F7F7', '#2C3E50'],
      },
    }],
    metadata: {
      provider: PROVIDER.CLAUDE,
      model: 'claude-sonnet-4.5-20250514',
      tokens: 640,
      latency: 1500,
    },
  },

  RATE_LIMIT_ERROR: {
    success: false,
    error: {
      type: ERROR_TYPE.RATE_LIMIT,
      message: 'Rate limit exceeded. Please retry after 1 second.',
    },
    metadata: {
      provider: PROVIDER.CLAUDE,
      model: 'claude-sonnet-4.5-20250514',
      tokens: 0,
      latency: 250,
    },
  },

  TIMEOUT_ERROR: {
    success: false,
    error: {
      type: ERROR_TYPE.TIMEOUT,
      message: 'Request timed out after 30000ms',
    },
    metadata: {
      provider: PROVIDER.OPENAI,
      model: 'gpt-4o',
      tokens: 0,
      latency: 30000,
    },
  },

  AUTH_ERROR: {
    success: false,
    error: {
      type: ERROR_TYPE.AUTH_ERROR,
      message: 'Invalid API key',
    },
    metadata: {
      provider: PROVIDER.CLAUDE,
      model: 'claude-sonnet-4.5-20250514',
      tokens: 0,
      latency: 120,
    },
  },

  INVALID_RESPONSE_ERROR: {
    success: false,
    error: {
      type: ERROR_TYPE.INVALID_RESPONSE,
      message: 'Failed to parse provider response',
    },
    metadata: {
      provider: PROVIDER.CLAUDE,
      model: 'claude-sonnet-4.5-20250514',
      tokens: 256,
      latency: 1100,
    },
  },
});
