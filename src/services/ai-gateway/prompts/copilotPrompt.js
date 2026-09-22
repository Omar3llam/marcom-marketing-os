// ============================================================
// AI Gateway — Copilot Q&A prompts (ANSWER_QUESTION)
// ============================================================
// Builds the {system, user} prompt for account-aware Q&A. The system prompt
// carries the live account context (workspace + deterministic account health +
// top campaigns by spend + the pre-generated portfolio briefing); the user
// prompt renders the conversation transcript + the current question (callClaude
// is single-turn, so multi-turn history is folded into the prompt text rather
// than native message roles).
//
// HONESTY RULES (baked into the system prompt):
//   - Every campaign figure is a REAL connector metric via the entity graph +
//     verdict engine — never fabricated.
//   - The prompt forbids inventing numbers and demands the model NAME the
//     missing metric instead of a vague "I don't have that data".
//   - The campaign list DISCLOSES that it is a top-N slice, and the rules carry
//     the true total — otherwise the model answers "how many campaigns?" with
//     the size of the slice, truthfully reading a context that hid the rest.
//   - No date is injected: a connector row is a rolling aggregate re-stamped
//     every sync, so any date would imply a time window the data can't support.
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
  const cur = currency || fallbackCurrency;
  if (!cur) return null;
  return formatCurrency(minor, cur, 'en-US');
}

/** Format a 0–1 fraction as a percentage; null-safe. */
function pct(frac) {
  return frac == null ? null : `${(Number(frac) * 100).toFixed(2)}%`;
}

/**
 * Every metric renders as a LABELLED field — an absent one prints "unavailable"
 * rather than vanishing. That distinction is load-bearing: the model can only
 * name which metric is missing if it can see that the field exists at all.
 * @param {number|null} value
 * @param {string} rendered — the formatted value when present
 */
function field(value, rendered) {
  return value == null || rendered == null ? 'unavailable' : rendered;
}

/**
 * @param {object} args
 * @param {object} args.workspace — { name, currency, objective, industry, market }
 * @param {object} args.portfolio — account-level facts the slice can't carry:
 *   { totalCampaigns, currency, health: {score,label,wastedSpendMinor,criticalCampaigns,healthyCampaigns}|null, totals }
 * @param {Array<object>} args.campaigns — the top-N slice:
 *   { name, channel, objective, verdict, rationale, roas, ctr, frequency,
 *     spendMinor, currency, conversions, revenueMinor, impressions, clicks }
 * @param {string|null} args.briefing — pre-generated LoopRun.aiInsight (may be null)
 * @param {boolean} [args.verdictsUnavailable] — the verdict computation FAILED for
 *   this request. Distinct from "no campaign has a verdict yet": one is an
 *   outage, the other is a fact about the account, and a model shown an absent
 *   verdict cannot tell them apart. When set, every verdict reads "unavailable"
 *   and the model is told not to answer questions that depend on one.
 * @returns {string} system prompt
 */
export function buildCopilotSystemPrompt({ workspace = {}, portfolio = {}, campaigns = [], briefing = null, verdictsUnavailable = false } = {}) {
  const establishedCurrency = portfolio.currency ?? null;
  const currencyStatus = portfolio.currencyStatus ?? 'UNKNOWN';
  const shown = (campaigns ?? []).length;
  const total = portfolio.totalCampaigns ?? shown;

  const health = portfolio.health;
  const healthBlock = health
    ? [
      'ACCOUNT HEALTH',
      health.score != null
        ? `Score: ${health.score}/100 (${health.label})`
        : `Score: unavailable (${health.currencyUnavailable ?? currencyStatus})`,
      `Wasted spend: ${field(health.wastedSpendMinor, money(health.wastedSpendMinor, establishedCurrency))}`,
      // Named by verdict so "critical" can never be misread as the CRITICAL
      // health label (a different axis entirely).
      health.criticalCampaigns != null ? `Campaigns to act on (KILL or REFRESH): ${health.criticalCampaigns}` : null,
      health.healthyCampaigns != null ? `Campaigns scaling well (SCALE): ${health.healthyCampaigns}` : null,
    ].filter(Boolean).join('\n')
    : 'ACCOUNT HEALTH: unavailable';

  const campaignLines = (campaigns ?? []).map((c) => {
    const lines = [
      // Three states, not two: a real verdict, "unscored" (we judged the account
      // and this campaign did not qualify), and "unavailable" (we could not
      // judge at all). Printing the third as the second is how an outage becomes
      // a claim about the campaign.
      `- ${c.name}${c.channel ? ` (${c.channel})` : ''} → ${verdictsUnavailable ? 'unavailable' : (c.verdict ?? 'unscored')}`,
      `  ROAS: ${field(c.roas, `${Number(c.roas).toFixed(2)}x`)}`,
      `  CTR: ${field(c.ctr, pct(c.ctr))}`,
      `  Freq: ${field(c.frequency, Number(c.frequency).toFixed(1))}`,
      `  Spend: ${field(c.spendMinor, money(c.spendMinor, c.currency, establishedCurrency))}`,
      `  Conversions: ${field(c.conversions, String(c.conversions))}`,
      `  Revenue: ${field(c.revenueMinor, money(c.revenueMinor, c.currency, establishedCurrency))}`,
    ];
    if (c.rationale) lines.push(`  (${c.rationale})`);
    return lines.join('\n');
  }).join('\n');

  const campaignHeader = total === 0
    ? 'CAMPAIGNS:\nNo campaigns synced yet.'
    : currencyStatus !== 'HOMOGENEOUS_KNOWN'
      ? `CAMPAIGN DETAILS: unavailable — currency population is ${currencyStatus}, so spend cannot be ranked.`
    : `CAMPAIGNS (showing top ${shown} of ${total} by spend)${
      total > shown ? `\n${total - shown} additional campaigns are not shown in this summary.` : ''
    }\n${campaignLines}`;

  return `You are Lumi, a MENA performance-marketing intelligence system embedded in the marketer's workspace. You have live access to this account's campaign data and verdicts.

WORKSPACE: ${workspace.name ?? 'Unknown'}
MARKET: ${workspace.market ?? 'MENA'}
CURRENCY: ${establishedCurrency ?? `unavailable (${currencyStatus})`}
OBJECTIVE: ${workspace.objective ?? 'performance marketing'}
INDUSTRY: ${workspace.industry ?? 'unknown'}

${healthBlock}

${campaignHeader}
${briefing ? `\nACCOUNT BRIEFING:\n${briefing}\n` : ''}
${verdictsUnavailable ? '\nVERDICTS: unavailable for this request — the verdict engine could not be reached. Campaign metrics above are real; no verdict, account health score or "what should I act on" answer can be given right now. Say so plainly if asked.\n' : ''}
RULES:
- Answer in 2-4 sentences unless real detail is genuinely needed.
- Cite specific campaign names, numbers, and verdicts from the data above.
- Never fabricate numbers that are not in the data.
- When a figure is missing or marked "unavailable", say so plainly AND name the exact metric that is absent — never claim you lack access to this account.
- Campaign metrics are the latest available snapshot, not a historical trend. If asked about a time period ("this week", "last month"), say the figures are a current snapshot and no period-over-period comparison is available.
- If a campaign's conversions are unavailable or zero, CPA cannot be derived for it — say that explicitly rather than estimating one.
- If asked how many campaigns exist, the answer is ${total} campaigns — not the number listed above.
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
