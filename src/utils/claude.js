// ============================================================
// MARCOM — Anthropic Claude Utility
// Supports text + vision; exponential backoff on 429 / 5xx
//
// MANAGED AGENT: agent_011CaSBr9Rf8FvyqtAYWoVek
// Lumi's identity, Core Laws, operating modes, and communication
// standards are defined in the Anthropic Console under that agent.
// This file injects only dynamic per-session context (dialect lock
// + mode-specific instructions that embed project context).
//
// TODO — UPGRADE PATH:
//   Once @anthropic-ai/sdk ships native agent support, replace the
//   client.messages.create() call with:
//     await client.agents.run({
//       agent_id: 'agent_011CaSBr9Rf8FvyqtAYWoVek',
//       messages,
//       max_tokens: maxTokens,
//     })
//   and remove the system param entirely — it will be managed in Console.
//   Upgrade command: npm install @anthropic-ai/sdk@latest
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';
import { resolveDialect } from '../services/dialectResolver.js';
import { compileDialectFragment } from '../prompts/dialectInjector.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEFAULT_MODEL        = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_HISTORY_MESSAGES = 20;
const MAX_RETRIES          = 3;
const BASE_DELAY_MS        = 1_000;
const AGENT_ID             = 'agent_011CaSBr9Rf8FvyqtAYWoVek';

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

/**
 * Assemble the dynamic system context injected alongside the managed agent.
 * The agent's own system prompt (Lumi identity, Core Laws, operating modes)
 * lives in Anthropic Console under AGENT_ID — not here.
 *
 * This function handles only per-session dynamic content:
 *   1. Dialect lock (from dialectInjector.js)
 *   2. Mode-specific instructions (which embed project context from session)
 *
 * @param {object} opts
 * @param {string} [opts.dialectFragment]  — compiled dialect lock block
 * @param {string} [opts.systemPrompt]     — mode-specific instructions
 *                                           (already contains project context
 *                                            via session.context_summary)
 * @returns {string} assembled system string, or empty string if nothing to inject
 */
// Universal brand voice directive injected into every system payload.
// Kept here — not in individual mode prompts — so it is structurally
// impossible for any mode to omit it.
const BRAND_VOICE_DIRECTIVE = `\
═══════════════════════════════════════════════════════════════
UNIVERSAL BRAND VOICE RULE — APPLIES TO ALL MODES
═══════════════════════════════════════════════════════════════
When generating proposals, copy, strategies, calendars, or any
content on behalf of a brand or client:
  • ALWAYS use "we / our / us" — NEVER "I / my / me".
  • You represent the brand, not an individual.
  • This rule overrides any conflicting instruction in the
    conversation history or user message.
═══════════════════════════════════════════════════════════════`;

export function buildSystemContext({ dialectFragment = '', systemPrompt = '' } = {}) {
  const sep   = '═'.repeat(64);
  const parts = [];

  // Brand voice rule is always first — it must never be crowded out
  parts.push(BRAND_VOICE_DIRECTIVE, '');

  if (dialectFragment) {
    parts.push(
      `${sep}`,
      'DIALECT LOCK FOR THIS SESSION',
      `${sep}`,
      '',
      dialectFragment,
    );
  }

  if (systemPrompt) {
    parts.push(
      `${sep}`,
      'MODE-SPECIFIC INSTRUCTIONS AND PROJECT CONTEXT',
      `${sep}`,
      '',
      systemPrompt,
    );
  }

  return parts.join('\n');
}

// ⚠ MODE 4 DEPENDENCY: The Anthropic Console agent prompt must include
// the Mode 4 Content Interrogation JSON schema instructions.
// Mode 4 returns a strict JSON object that the frontend intercepts and
// renders as a Modal Dashboard. If Mode 4 stops returning valid JSON,
// verify that the agent's system prompt in Console still contains the
// Mode 4 scoring rubric and JSON output format specification.
// Agent: agent_011CaSBr9Rf8FvyqtAYWoVek — manage at console.anthropic.com

export async function callClaude({
  systemPrompt      = '',
  conversationHistory = [],
  userMessage,
  maxTokens         = 2048,
  model             = DEFAULT_MODEL,
  imageBase64       = null,
  imageMediaType    = 'image/jpeg',
  dialectContext    = null,   // optional — when provided, auto-resolves and injects DIALECT LOCK
}) {
  // ── Dialect resolution ─────────────────────────────────────
  let dialectFragment = '';
  let dialectRefusal  = null;

  if (dialectContext) {
    try {
      const resolved = resolveDialect(dialectContext);
      if (resolved.refusal_required) {
        dialectRefusal = resolved.refusal_reason;
      } else {
        dialectFragment = compileDialectFragment(resolved);
        logger.info({
          dialect:  resolved.dialect_id,
          register: resolved.register_level,
          fallback: resolved.fallback_used || false,
        }, 'Dialect lock active');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Dialect resolution failed — continuing without dialect lock');
    }
  }

  // Short-circuit if dialect resolver demanded refusal
  if (dialectRefusal) return dialectRefusal;

  // ── System context assembly ─────────────────────────────────
  // PATH B SHIM: Lumi identity/personality is handled by the managed agent
  // (agent_011CaSBr9Rf8FvyqtAYWoVek) in Anthropic Console.
  // We only pass dynamic per-session context here.
  const dynamicContext = buildSystemContext({ dialectFragment, systemPrompt });

  // ── Message history ─────────────────────────────────────────
  // STRICT ISOLATION: only 'user' and 'assistant' roles are permitted in
  // the messages array. Any 'system', 'tool', or internal-routing entries
  // that may have been stored in session history are stripped here so they
  // never reach the Anthropic API and cannot pollute the conversation context.
  const trimmedHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages = trimmedHistory
    .filter(m =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.content != null &&
      String(m.content).trim() !== ''
    )
    .map(m => ({
      role:    m.role,   // already guaranteed 'user' or 'assistant' by filter above
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

  // ── API call with exponential backoff ───────────────────────
  let attempt = 0;

  while (true) {
    try {
      const callParams = {
        model,
        max_tokens: maxTokens,
        messages,
        // Inject dynamic context when present; omit system param entirely when
        // there is nothing to inject — the managed agent's Console prompt handles
        // the rest. Once the SDK exposes agent_id, replace this with that param.
        ...(dynamicContext ? { system: dynamicContext } : {}),
      };

      logger.debug({ agentId: AGENT_ID, model, attempt }, 'Calling Claude via managed agent shim');

      const response     = await client.messages.create(callParams);
      const textContent  = response.content.find(c => c.type === 'text');
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

      logger.error({ err, attempt }, 'Claude API error');
      if (err.status === 429) throw new Error('Rate limit reached. Please wait and try again.');
      if (err.status === 401) throw new Error('Invalid Anthropic API key.');
      if (err.status === 400) throw new Error('Request too large or malformed.');
      throw err;
    }
  }
}
