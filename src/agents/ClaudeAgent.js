// ============================================================
// MARCOM / Lumi — ClaudeAgent (Phase 4)
// ------------------------------------------------------------
// Wraps Anthropic Claude with the Phase-4 context-injection
// contract: every call automatically prepends the campaign's
// CampaignState.stage and the last 3 DecisionMemory entries.
//
// The base Anthropic SDK call is delegated to the existing
// utility in `src/utils/claude.js` so token/header/retry logic
// stays in one place.
// ============================================================
import { callClaude }          from '../utils/claude.js';
import { getRenderedContext }  from './contextBuilder.js';
import { logger }              from '../utils/logger.js';

const TOOL_TIMEOUT_MS = 10_000;     // Phase-4 spec: 10 s per tool

/**
 * @param {object} opts
 * @param {string} opts.campaignId      — required for context injection
 * @param {string} opts.role            — role prompt ("You are an expert ...")
 * @param {string} opts.task            — the actual user task
 * @param {Array}  [opts.history]       — prior conversation turns
 * @param {Array}  [opts.tools]         — Anthropic tool definitions
 * @param {Function} [opts.onTool]      — tool dispatcher: ({ name, input }) => result
 * @param {number} [opts.maxTokens=2000]
 */
export async function runClaudeAgent({
  campaignId, role, task, history = [],
  tools = [], onTool = null, maxTokens = 2000,
}) {
  const ctxBlock = campaignId ? await getRenderedContext(campaignId) : '';

  const systemPrompt = [
    role || 'You are Lumi, an autonomous marketing intelligence agent.',
    ctxBlock || '',
    'Use the campaign context above to ground every recommendation. ' +
    'If a recent decision regressed, do NOT recommend the same action again ' +
    'unless you can articulate what would change.',
  ].filter(Boolean).join('\n\n');

  const result = await callClaude({
    systemPrompt,
    conversationHistory: history,
    userMessage: task,
    maxTokens,
    tools,
    onTool: onTool ? withTimeout(onTool, TOOL_TIMEOUT_MS) : null,
  });

  return { text: result, contextInjected: Boolean(ctxBlock) };
}

// ── Tool-call timeout wrapper ────────────────────────────────
// Phase-4 spec mandates a hard 10 s ceiling on each tool
// invocation so a slow Meta Insights call can't stall the agent.
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
      logger.warn({ tool: toolCall?.name, err: err.message }, '[ClaudeAgent] tool failed');
      // Surface the error back to the model as a structured result
      // so it can recover instead of crashing the whole turn.
      return { error: err.message, tool: toolCall?.name };
    } finally {
      clearTimeout(timer);
    }
  };
}
