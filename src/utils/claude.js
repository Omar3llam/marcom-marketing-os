// ============================================================
// MARCOM — Anthropic Claude Utility
// Supports text + vision; exponential backoff on 429 / 5xx
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_MODEL        = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_HISTORY_MESSAGES = 20;
const MAX_RETRIES          = 3;
const BASE_DELAY_MS        = 1_000;

function isRetryable(err) {
  const status = err.status ?? err.statusCode;
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strip markdown code fences that Claude sometimes wraps JSON in.
 * Safe to call on plain JSON strings — leaves them untouched.
 */
export function stripJsonFences(raw = '') {
  return raw
    .replace(/^```(?:json)?[\r\n]*/gi, '')  // opening fence
    .replace(/[\r\n]*```\s*$/gi, '')         // closing fence
    .trim();
}

export async function callClaude({
  systemPrompt,
  conversationHistory = [],
  userMessage,
  maxTokens = 2048,
  model = DEFAULT_MODEL,
  imageBase64 = null,
  imageMediaType = 'image/jpeg',
}) {
  const trimmedHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages = trimmedHistory
    .filter(m => m.role && m.content)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

  const finalUserContent = imageBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
        { type: 'text', text: userMessage },
      ]
    : userMessage;

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: finalUserContent });
  } else {
    messages[messages.length - 1].content = finalUserContent;
  }

  let attempt = 0;

  while (true) {
    try {
      const response = await client.messages.create({ model, max_tokens: maxTokens, system: systemPrompt, messages });
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) throw new Error('No text content in Claude response');
      return textContent.text;

    } catch (err) {
      attempt++;
      if (isRetryable(err) && attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn({ attempt, delay, status: err.status }, 'Claude API retryable error — backing off');
        await sleep(delay);
        continue;
      }

      // Non-retryable or max retries exceeded
      logger.error({ err, attempt }, 'Claude API error');
      if (err.status === 429) throw new Error('Rate limit reached. Please wait and try again.');
      if (err.status === 401) throw new Error('Invalid Anthropic API key.');
      if (err.status === 400) throw new Error('Request too large or malformed.');
      throw err;
    }
  }
}
