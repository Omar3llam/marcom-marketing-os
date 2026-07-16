// ============================================================
// Claude Provider — Anthropic Claude API integration
// ============================================================
// Implements AI capabilities using Claude Sonnet 4.5.
//
// CAPABILITIES:
//   - generateCopy (hooks, captions, full copy)
//   - generateStrategy (audience, angle variants)
//   - validateContent (brand compliance)
//   - rankVariants (performance prediction)
//
// ERROR HANDLING:
//   Returns structured error objects (never throws).
//   Error types: RATE_LIMIT, TIMEOUT, INVALID_RESPONSE, AUTH_ERROR
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { ERROR_TYPE, MODEL } from '../providerTypes.js';
import { getSystemPrompt } from '../prompts/systemPrompts.js';
import { buildCopyPrompt } from '../prompts/copyPrompts.js';
import { buildCaptionPrompt } from '../prompts/captionPrompts.js';
import { buildVisualBriefPrompt } from '../prompts/visualBriefPrompts.js';
import { buildReasoningPrompt } from '../prompts/reasoningPrompts.js';
import { logger } from '../../../utils/logger.js';

// Lazy client instantiation (allows tests to run without API key)
let anthropic = null;
function getClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

// Env-driven so the gateway shares ONE model source with utils/claude.js +
// render.yaml (ANTHROPIC_MODEL). The constant is only the fallback for local dev.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || MODEL.CLAUDE_SONNET_4;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT = 30000; // 30s

// ============================================================
// Core API call wrapper
// ============================================================

async function callClaude({ systemPrompt, userPrompt, maxTokens = DEFAULT_MAX_TOKENS, timeout = DEFAULT_TIMEOUT }) {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const client = getClient();
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = response.content[0]?.text || '';
    const latency = Date.now() - startTime;

    return {
      success: true,
      text,
      metadata: {
        model: response.model,
        tokens: response.usage.input_tokens + response.usage.output_tokens,
        latency,
      },
    };
  } catch (error) {
    const latency = Date.now() - startTime;

    logger.error({
      error: error.message,
      latency,
    }, '[ClaudeProvider] API call failed');

    return {
      success: false,
      error: {
        type: classifyError(error),
        message: error.message,
      },
      metadata: {
        model: DEFAULT_MODEL,
        tokens: 0,
        latency,
      },
    };
  }
}

function classifyError(error) {
  const message = error.message?.toLowerCase() || '';

  if (message.includes('rate limit') || message.includes('429')) {
    return ERROR_TYPE.RATE_LIMIT;
  }
  if (message.includes('timeout') || message.includes('aborted')) {
    return ERROR_TYPE.TIMEOUT;
  }
  if (message.includes('authentication') || message.includes('api key') || message.includes('401')) {
    return ERROR_TYPE.AUTH_ERROR;
  }
  if (message.includes('invalid') || message.includes('malformed')) {
    return ERROR_TYPE.INVALID_RESPONSE;
  }

  return ERROR_TYPE.PROVIDER_ERROR;
}

function parseJSON(text) {
  try {
    // Remove markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
    }

    return JSON.parse(cleaned);
  } catch (_error) {
    logger.warn({ text }, '[ClaudeProvider] JSON parse failed');
    return null;
  }
}

// ============================================================
// Capability implementations
// ============================================================

export async function generateCopy(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_COPY', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !parsed.hook) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse copy generation response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      hook: parsed.hook,
      body: parsed.body,
      cta: parsed.cta,
      rationale: parsed.rationale,
    },
    artifacts: [
      { type: 'copy', id: 'hook', content: parsed.hook },
      { type: 'copy', id: 'body', content: parsed.body },
    ],
    metadata: result.metadata,
  };
}

export async function generateHooks(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_HOOKS', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse hooks response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      hooks: parsed,
      count: parsed.length,
    },
    artifacts: parsed.map((h, index) => ({
      type: 'hook',
      id: `hook_${index}`,
      content: h.hook,
      angle: h.angle,
    })),
    metadata: result.metadata,
  };
}

export async function generateCaptions(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_CAPTIONS', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse captions response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      captions: parsed,
      count: parsed.length,
    },
    artifacts: parsed.map((c, index) => ({
      type: 'caption',
      id: `caption_${index}`,
      content: c.caption,
      tone: c.tone,
    })),
    metadata: result.metadata,
  };
}

export async function generateAudienceHypotheses(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('MARKETING_STRATEGIST');
  const userPrompt = buildCaptionPrompt('GENERATE_AUDIENCE_HYPOTHESES', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse audience hypotheses response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      hypotheses: parsed,
      count: parsed.length,
    },
    artifacts: parsed.map((h, index) => ({
      type: 'audience_hypothesis',
      id: `hypothesis_${index}`,
      content: h.hypothesis,
    })),
    metadata: result.metadata,
  };
}

export async function generateAngleVariants(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('MARKETING_STRATEGIST');
  const userPrompt = buildCaptionPrompt('GENERATE_ANGLE_VARIANTS', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse angle variants response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      angles: parsed,
      count: parsed.length,
    },
    artifacts: parsed.map((a, index) => ({
      type: 'angle',
      id: `angle_${index}`,
      content: a.angle,
    })),
    metadata: result.metadata,
  };
}

export async function validateContent(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('MARKETING_STRATEGIST');
  const userPrompt = buildVisualBriefPrompt('VALIDATE_CONTENT', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt, maxTokens: 1024 });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || typeof parsed.isValid !== 'boolean') {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse validation response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      isValid: parsed.isValid,
      score: parsed.score,
      issues: parsed.issues || [],
      suggestions: parsed.suggestions || [],
      approved: parsed.approved,
    },
    artifacts: [],
    metadata: result.metadata,
  };
}

export async function rankVariants(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('MARKETING_STRATEGIST');
  const userPrompt = buildVisualBriefPrompt('RANK_VARIANTS', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt, maxTokens: 1536 });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse ranking response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      rankings: parsed,
      count: parsed.length,
    },
    artifacts: [],
    metadata: result.metadata,
  };
}

// EXPLAIN_VERDICT — on-demand prose reasoning for a single campaign verdict.
// Unlike the copy/strategy capabilities this returns PROSE, not JSON: the output
// is `reasoning` text, capped short (maxTokens 260 — enough for 2-3 sentences,
// Arabic included). The caller resolves every signal from real rows; this method
// never invents data (the prompt forbids it).
export async function explainVerdict(input) {
  const { system, user } = buildReasoningPrompt(input || {});

  const result = await callClaude({ systemPrompt: system, userPrompt: user, maxTokens: 260 });

  if (!result.success) {
    return result;
  }

  const reasoning = (result.text || '').trim();
  if (!reasoning) {
    return {
      success: false,
      error: { type: ERROR_TYPE.INVALID_RESPONSE, message: 'Empty reasoning response' },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: { reasoning },
    artifacts: [],
    metadata: result.metadata,
  };
}

/**
 * ANALYZE_PORTFOLIO — an ADVISORY account-level narration.
 *
 * Returns PROSE (`insight`), deliberately NOT JSON: this capability advises
 * ALONGSIDE the deterministic verdict engine and must never emit a verdict
 * structure that could be mistaken for — or written over — a real Decision.
 * The caller resolves every number and verdict from real rows before building
 * the prompt; this method never invents data (the prompt forbids it).
 */
export async function analyzePortfolio({ system, user }) {
  const result = await callClaude({ systemPrompt: system, userPrompt: user, maxTokens: 220 });

  if (!result.success) {
    return result;
  }

  const insight = (result.text || '').trim();
  if (!insight) {
    return {
      success: false,
      error: { type: ERROR_TYPE.INVALID_RESPONSE, message: 'Empty portfolio analysis response' },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: { insight },
    artifacts: [],
    metadata: result.metadata,
  };
}

/**
 * Copilot Q&A — account-aware prose answer. The route assembles the account
 * context into `system` and the conversation transcript + question into `user`
 * (callClaude is single-turn, so multi-turn history is rendered into the prompt).
 */
export async function answerQuestion({ system, user }) {
  const result = await callClaude({ systemPrompt: system, userPrompt: user, maxTokens: 400 });

  if (!result.success) {
    return result;
  }

  const answer = (result.text || '').trim();
  if (!answer) {
    return {
      success: false,
      error: { type: ERROR_TYPE.INVALID_RESPONSE, message: 'Empty answer response' },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: { answer },
    artifacts: [],
    metadata: result.metadata,
  };
}

export async function generateVisualBrief(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('VISUAL_STRATEGIST');
  const userPrompt = buildVisualBriefPrompt('GENERATE_VISUAL_BRIEF', input, decisionContext);

  const result = await callClaude({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !parsed.concept) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse visual brief response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      concept: parsed.concept,
      colorPalette: parsed.colorPalette || [],
      composition: parsed.composition,
      typography: parsed.typography,
      mobileOptimization: parsed.mobileOptimization,
      rationale: parsed.rationale,
    },
    artifacts: [{
      type: 'visual_brief',
      id: 'brief',
      content: parsed,
    }],
    metadata: result.metadata,
  };
}
