// ============================================================
// MARCOM / Lumi — ChatGPTAgent (Phase 4)
// ------------------------------------------------------------
// Mirror of ClaudeAgent for OpenAI models. The shared context-injection
// contract (CampaignState.stage + recent DecisionMemory) was retired in S1-B
// along with both populations; same 10 s tool timeout, plus a DALL-E fallback for
// `generateVisual()` so creative brainstorming never hard-fails
// when the image endpoint rate-limits or 5xxs.
// ============================================================
import OpenAI                   from 'openai';
import { logger }               from '../utils/logger.js';

const TOOL_TIMEOUT_MS = 10_000;
const TEXT_MODEL  = process.env.OPENAI_TEXT_MODEL  || 'gpt-4o-mini';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'dall-e-3';

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Run a chat completion with injected campaign context.
 */
export async function runChatGPTAgent({
  role, task, history = [],
  tools = [], onTool = null, maxTokens = 2000,
}) {
  // S1-B — same as runClaudeAgent: the CampaignState-backed context block is
  // retired, not repointed, and so is the instruction that pointed at it.
  const systemPrompt = role || 'You are Lumi, an autonomous marketing intelligence agent.';

  const messages = [
    { role: 'system',  content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user',    content: task },
  ];

  const wrappedTool = onTool ? withTimeout(onTool, TOOL_TIMEOUT_MS) : null;

  const completion = await client().chat.completions.create({
    model:       TEXT_MODEL,
    messages,
    tools:       tools.length ? tools : undefined,
    max_tokens:  maxTokens,
  });

  const choice = completion.choices?.[0];
  const text   = choice?.message?.content || '';
  const calls  = choice?.message?.tool_calls || [];

  // Single-pass tool dispatch (the agent loop above can re-invoke
  // for multi-step). We surface the raw tool results so callers can
  // continue the conversation.
  const toolResults = [];
  if (wrappedTool && calls.length) {
    for (const c of calls) {
      const result = await wrappedTool({
        name:  c.function?.name,
        input: safeJson(c.function?.arguments),
      });
      toolResults.push({ id: c.id, result });
    }
  }

  return { text, toolResults, contextInjected: false };
}

/**
 * Generate a visual concept. Tries DALL-E first; on ANY failure
 * falls back to returning a structured *brief* (text-only) so the
 * caller — and the human downstream — still gets a usable artefact.
 */
export async function generateVisual({ prompt, size = '1024x1024' }) {
  if (!prompt) throw new Error('generateVisual: prompt is required');

  try {
    const res = await client().images.generate({
      model:  IMAGE_MODEL,
      prompt,
      n:      1,
      size,
    });
    const url = res.data?.[0]?.url;
    if (!url) throw new Error('Image API returned no URL');
    return { ok: true, kind: 'image', url, prompt };
  } catch (err) {
    logger.warn({ err: err.message }, '[ChatGPTAgent] DALL-E failed — falling back to text brief');
    // Fallback path: ask the text model to produce a written
    // visual brief the design team can execute manually.
    try {
      const fallback = await client().chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          { role: 'system', content: 'You are an art director. Convert the user prompt into a tight visual brief: subject, framing, palette, mood, lighting, type-treatment. Max 120 words.' },
          { role: 'user',   content: prompt },
        ],
        max_tokens: 250,
      });
      const brief = fallback.choices?.[0]?.message?.content || '';
      return { ok: true, kind: 'brief', brief, prompt, fallback: true, reason: err.message };
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr.message }, '[ChatGPTAgent] visual fallback also failed');
      return { ok: false, kind: 'error', error: fallbackErr.message, prompt };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────
function withTimeout(fn, ms) {
  return async (toolCall) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Tool '${toolCall?.name}' timed out after ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([fn(toolCall), timeout]);
    } catch (err) {
      logger.warn({ tool: toolCall?.name, err: err.message }, '[ChatGPTAgent] tool failed');
      return { error: err.message, tool: toolCall?.name };
    } finally {
      clearTimeout(timer);
    }
  };
}

function safeJson(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
