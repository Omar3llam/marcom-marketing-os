// ============================================================
// OpenAI Provider — OpenAI GPT API integration
// ============================================================
// Implements AI capabilities using GPT-4o.
//
// CAPABILITIES:
//   - generateHooks (ad hooks, CTAs)
//   - generateCopy (full ad copy)
//   - generateCaptions (optimized for creative + conversational)
//   - generateVisualPrompt (DALL·E-ready prompts)
//   - summarizeCreative (creative brief summaries)
//
// ERROR HANDLING:
//   Returns structured error objects (never throws).
// ============================================================
import OpenAI from 'openai';
import { ERROR_TYPE, MODEL } from '../providerTypes.js';
import { getSystemPrompt } from '../prompts/systemPrompts.js';
import { buildCopyPrompt } from '../prompts/copyPrompts.js';
import { buildVisualBriefPrompt } from '../prompts/visualBriefPrompts.js';
import { logger } from '../../../utils/logger.js';

// Lazy client instantiation (allows tests to run without API key)
let openai = null;
function getClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

// Use GPT-4o-mini for content generation (70% cheaper than GPT-4o)
// Switch to GPT_4O via env var if higher quality needed
const DEFAULT_MODEL = process.env.OPENAI_MODEL || MODEL.GPT_4O_MINI;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT = 30000; // 30s

// ============================================================
// Core API call wrapper
// ============================================================

async function callOpenAI({ systemPrompt, userPrompt, maxTokens = DEFAULT_MAX_TOKENS, timeout = DEFAULT_TIMEOUT }) {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const client = getClient();
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = response.choices[0]?.message?.content || '';
    const latency = Date.now() - startTime;

    return {
      success: true,
      text,
      metadata: {
        model: response.model,
        tokens: response.usage.total_tokens,
        latency,
      },
    };
  } catch (error) {
    const latency = Date.now() - startTime;

    logger.error({
      error: error.message,
      latency,
    }, '[OpenAIProvider] API call failed');

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
    return JSON.parse(text.trim());
  } catch (_error) {
    logger.warn({ text }, '[OpenAIProvider] JSON parse failed');
    return null;
  }
}

// ============================================================
// Capability implementations
// ============================================================

export async function generateHooks(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_HOOKS', input, decisionContext);

  const result = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 1024 });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !Array.isArray(parsed.hooks)) {
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
      hooks: parsed.hooks,
      count: parsed.hooks.length,
    },
    artifacts: parsed.hooks.map((h, index) => ({
      type: 'hook',
      id: `hook_${index}`,
      content: h.hook || h,
    })),
    metadata: result.metadata,
  };
}

export async function generateCopy(input, decisionContext = {}) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_COPY', input, decisionContext);

  const result = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 2048 });

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
      { type: 'hook', id: 'hook', content: parsed.hook },
      { type: 'body', id: 'body', content: parsed.body },
      { type: 'cta', id: 'cta', content: parsed.cta },
    ],
    metadata: result.metadata,
  };
}

export async function generateCaptions(input) {
  const systemPrompt = getSystemPrompt('CREATIVE_COPYWRITER');
  const userPrompt = buildCopyPrompt('GENERATE_CAPTIONS', input);

  const result = await callOpenAI({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !parsed.captions || !Array.isArray(parsed.captions)) {
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
      captions: parsed.captions,
      count: parsed.captions.length,
    },
    artifacts: parsed.captions.map((c, index) => ({
      type: 'caption',
      id: `caption_${index}`,
      content: c.caption || c,
    })),
    metadata: result.metadata,
  };
}

export async function generateVisualPrompt(input) {
  const systemPrompt = getSystemPrompt('VISUAL_STRATEGIST');
  const userPrompt = buildVisualBriefPrompt('GENERATE_VISUAL_PROMPT', input);

  const result = await callOpenAI({ systemPrompt, userPrompt });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !parsed.prompt) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse visual prompt response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      prompt: parsed.prompt,
      negativePrompt: parsed.negativePrompt || '',
      styleModifiers: parsed.styleModifiers || [],
      technicalParams: parsed.technicalParams || {},
    },
    artifacts: [{
      type: 'visual_prompt',
      id: 'prompt',
      content: parsed.prompt,
    }],
    metadata: result.metadata,
  };
}

export async function summarizeCreative(input) {
  const systemPrompt = getSystemPrompt('MARKETING_STRATEGIST');
  const userPrompt = `Summarize the following creative brief in 2-3 sentences:

${input.brief}

Return JSON: { "summary": "text here" }`;

  const result = await callOpenAI({ systemPrompt, userPrompt, maxTokens: 512 });

  if (!result.success) {
    return result;
  }

  const parsed = parseJSON(result.text);
  if (!parsed || !parsed.summary) {
    return {
      success: false,
      error: {
        type: ERROR_TYPE.INVALID_RESPONSE,
        message: 'Failed to parse summary response',
      },
      metadata: result.metadata,
    };
  }

  return {
    success: true,
    output: {
      summary: parsed.summary,
    },
    artifacts: [],
    metadata: result.metadata,
  };
}
