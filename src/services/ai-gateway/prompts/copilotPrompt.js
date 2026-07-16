// ============================================================
// AI Gateway — Copilot Q&A prompts (ANSWER_QUESTION)
// ============================================================
// Builds the {system, user} prompt for account-aware Q&A. The system prompt
// carries the live account context (workspace + top campaigns by spend + the
// pre-generated portfolio briefing); the user prompt renders the conversation
// transcript + the current question (callClaude is single-turn, so multi-turn
// history is folded into the prompt text rather than native message roles).
//
// HONESTY RULES (baked into the system prompt):
//   - Every campaign figure is a REAL connector metric via the entity graph +
//     verdict engine — never fabricated.
//   - The prompt forbids inventing numbers and demands an honest "I don't have
//     that data" when the answer isn't backed by the context.
// ============================================================
import { formatCurrency } from '../../../lib/money.js';

/**
 * Format a minor-unit amount as "<CUR> <major>"; null-safe.
 *
 * Delegates the minor→major conversion to lib/money so the exponent comes from
 * the currency, not a hardcoded /100: a Gulf dinar is 1000 fils, so dividing by
 * 100 told the model a KWD account spent 10x what it did. en-US is pinned
 * deliberately — formatCurrency defaults to the market locale (ar-EG, ar-KW),
 * which would put Arabic-Indic digits in a prompt the model has to reason over.
 */
function money(minor, currency, fallbackCurrency) {
  if (minor == null) return null;
  const cur = currency || fallbackCurrency || 'USD';
  return formatCurrency(minor, cur, 'en-US');
}

/** Format a 0–1 fraction as a percentage; null-safe. */
function pct(frac) {
  return frac == null ? null : `${(Number(frac) * 100).toFixed(2)}%`;
}

/**
 * @param {object} workspace — { name, currency, objective, industry, market }
 * @param {Array<object>} campaigns — top campaigns:
 *   { name, channel, objective, verdict, rationale, roas, ctr, frequency, spendMinor, currency }
 * @param {string|null} briefing — pre-generated LoopRun.aiInsight (may be null)
 * @returns {string} system prompt
 */
export function buildCopilotSystemPrompt(workspace = {}, campaigns = [], briefing = null) {
  const wsCurrency = workspace.currency || 'USD';

  const campaignLines = (campaigns ?? []).map((c) => {
    const parts = [`${c.name}${c.channel ? ` (${c.channel})` : ''}`];
    if (c.verdict) parts.push(`→ ${c.verdict}`);
    if (c.roas != null) parts.push(`ROAS ${Number(c.roas).toFixed(2)}x`);
    if (c.ctr != null) parts.push(`CTR ${pct(c.ctr)}`);
    if (c.frequency != null) parts.push(`Freq ${Number(c.frequency).toFixed(1)}`);
    if (c.spendMinor != null) parts.push(`Spend ${money(c.spendMinor, c.currency, wsCurrency)}`);
    if (c.rationale) parts.push(`(${c.rationale})`);
    return `- ${parts.join(' · ')}`;
  }).join('\n');

  return `You are Lumi, a MENA performance-marketing intelligence system embedded in the marketer's workspace. You have live access to this account's campaign data and verdicts.

WORKSPACE: ${workspace.name ?? 'Unknown'}
MARKET: ${workspace.market ?? 'MENA'}
CURRENCY: ${wsCurrency}
OBJECTIVE: ${workspace.objective ?? 'performance marketing'}
INDUSTRY: ${workspace.industry ?? 'unknown'}

CURRENT PORTFOLIO (top campaigns by spend):
${campaignLines || 'No campaigns synced yet.'}
${briefing ? `\nACCOUNT BRIEFING:\n${briefing}\n` : ''}
RULES:
- Answer in 2-4 sentences unless real detail is genuinely needed.
- Cite specific campaign names, numbers, and verdicts from the data above.
- Never fabricate numbers that are not in the data. If you lack the data to answer, say so plainly.
- Be direct — no "great question!" or filler.
- Respond in the same language the user writes in.
- You may reference earlier messages in this conversation.`;
}

/**
 * Render the conversation transcript + current question into a single user turn.
 * @param {Array<{role:'user'|'assistant', content:string}>} history
 * @param {string} question
 * @returns {string} user prompt
 */
export function buildCopilotUserPrompt(history = [], question = '') {
  const turns = (history ?? [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => `${m.role === 'user' ? 'User' : 'Lumi'}: ${m.content}`)
    .join('\n');

  if (!turns) return question;
  return `Conversation so far:\n${turns}\n\nCurrent question: ${question}`;
}
