// ============================================================
// portfolioAnalysisPrompt — ADVISORY account-level narration (ANALYZE_PORTFOLIO)
// ============================================================
// Builds the prompt for the short portfolio advisory shown on Overview.
//
// GOVERNING LAW — this capability ADVISES ALONGSIDE the deterministic verdict
// engine; it never assigns, changes, or overrides a verdict. Every verdict,
// metric, health score and needs-revenue flag handed in here is already computed
// upstream from real rows (verdictEngine / AccountHealthService /
// connectorVerdictService). The model's only job is to NARRATE what those
// deterministic signals already say.
//
// Three honesty rules are pinned into the system prompt, mirroring the rest of
// the codebase (no fabricated numbers, "—" not 0):
//   • never invent a number, campaign, or verdict that isn't in the input
//   • never manufacture decisiveness — a genuinely stable portfolio is a valid
//     finding, and "you should kill something" is NOT to be forced
//   • an unmeasured conversion campaign is a MEASUREMENT GAP, not a bad campaign
// ============================================================
import { formatCurrency } from '../../../lib/money.js';

// Prompt budget: the largest accounts run to hundreds of campaigns, so the
// narration is grounded in the top slice by spend (the caller sorts). The count
// of everything else still rides in the stats, so the model is never told the
// portfolio is smaller than it is.
export const CAMPAIGN_LIMIT = 12;

/**
 * PURE: minor units → a display amount, or "unknown" (never a fabricated 0).
 *
 * The exponent comes from the currency via lib/money, not a hardcoded /100 — a
 * Gulf dinar is 1000 fils, so /100 narrated a KWD account at 10x its real spend.
 * en-US is pinned deliberately: formatCurrency defaults to the market locale
 * (ar-EG, ar-KW), which would put Arabic-Indic digits in front of the model.
 * The "unknown" guard stays ours — formatCurrency's "—" reads as a real dash to
 * a model, where "unknown" is unambiguous.
 */
function money(minor, currency) {
  if (!Number.isFinite(minor)) return 'unknown';
  return formatCurrency(minor, currency, 'en-US');
}

const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : 'unknown');
const num = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'unknown');

/** PURE: one campaign → its grounded prompt block. */
function campaignLine(c, i, currency) {
  const roas = Number.isFinite(c.roas)
    ? `${num(c.roas, 2)}x`
    : (c.needsRevenue ? 'no revenue measured (tracking gap)' : 'unknown');
  return [
    `${i + 1}. "${c.name}" (${c.channel ?? 'unknown channel'})`,
    `   objective: ${c.objective ?? 'unknown'}`,
    `   verdict (deterministic): ${c.verdict ?? 'not scored'}`,
    `   spend: ${money(c.spendMinor, currency)}`,
    `   roas: ${roas}`,
    `   ctr: ${pct(c.ctr)}`,
    `   frequency: ${num(c.frequency)}`,
  ].join('\n');
}

/**
 * PURE: build the ANALYZE_PORTFOLIO prompt.
 * @param {object} stats — deterministic rollup { total, verdictCounts, healthScore,
 *   healthLabel, wastedPct, needsRevenueCount }
 * @param {Array<object>} campaigns — enriched rows (verdict + needsRevenue already resolved)
 * @param {object} workspace — { name, currency, objective, market, industry }
 * @returns {{ system: string, user: string }}
 */
export function buildPortfolioAnalysisPrompt(stats = {}, campaigns = [], workspace = {}) {
  const currency = workspace.currency || 'USD';
  const shown = campaigns.slice(0, CAMPAIGN_LIMIT);
  const counts = stats.verdictCounts ?? {};

  const system = [
    'You are a MENA performance marketing analyst writing a short portfolio note for a media buyer.',
    '',
    'The verdicts you are given were already decided by a deterministic engine from real',
    'delivery data. You are NOT assigning verdicts. Your job is to narrate what the data',
    'already says and point to the most useful next step.',
    '',
    'Rules — these are absolute:',
    '- Use ONLY the numbers, campaigns and verdicts given below. Never invent or estimate one.',
    '- Never contradict or re-assign a deterministic verdict.',
    '- Do NOT manufacture urgency. If the portfolio is genuinely stable, say that plainly.',
    '  "Nothing needs action today" is a valid and useful finding.',
    '- "no revenue measured" on a conversion campaign is a MEASUREMENT GAP (revenue tracking',
    '  is missing), NOT evidence the campaign is failing. Never call such a campaign bad —',
    '  say its ROAS cannot be scored until revenue data lands.',
    '- Where a metric says "unknown", stay silent about it rather than guessing.',
    '',
    'Write 2-3 plain sentences. No headings, no lists, no preamble — just the note.',
  ].join('\n');

  const user = [
    `Account: ${workspace.name ?? 'this account'}${workspace.market ? ` (${workspace.market})` : ''}`,
    workspace.industry ? `Industry: ${workspace.industry}` : null,
    `Stated objective: ${workspace.objective ?? 'unstated'}`,
    '',
    `Campaigns with spend: ${stats.total ?? shown.length}`,
    `Verdict mix: ${['KILL', 'REFRESH', 'WATCH', 'HOLD', 'SCALE', 'REALLOCATE']
      .map((v) => `${v} ${counts[v] ?? 0}`)
      .join(' · ')}`,
    stats.healthScore != null ? `Account health: ${stats.healthScore}/100 (${stats.healthLabel ?? 'unlabelled'})` : 'Account health: unknown',
    stats.wastedPct != null ? `Wasted spend: ${num(stats.wastedPct, 1)}% of spend` : null,
    `Campaigns whose ROAS cannot be scored (no revenue measured): ${stats.needsRevenueCount ?? 0}`,
    '',
    `CAMPAIGNS (top ${shown.length} by spend):`,
    shown.map((c, i) => campaignLine(c, i, currency)).join('\n\n'),
    '',
    'Write the 2-3 sentence portfolio note now.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
