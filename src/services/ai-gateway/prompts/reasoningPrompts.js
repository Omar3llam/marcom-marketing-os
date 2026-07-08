// ============================================================
// AI Gateway — campaign verdict reasoning prompt (EXPLAIN_VERDICT)
// ============================================================
// Builds the {system, user} prompt for on-demand, plain-language reasoning about
// a single campaign's verdict. Prose (not JSON), 2-3 sentences.
//
// HONESTY RULES baked into the prompt:
//   - Every value is a REAL signal the caller resolved server-side from
//     MetricSnapshot rows via the verdict engine. Null/absent signals are
//     rendered as "not available" — we NEVER pass a raw null the model could
//     invent a number for.
//   - The system prompt forbids fabricating numbers and demands directness.
//
// LANGUAGE:
//   dialect ids come from onboarding (DIALECTS: 'egy' | 'gulf'); anything else
//   (or absent) → English. Reasoning is internal operator decision-support, so
//   English is a safe default, not a fabrication.
// ============================================================

// Onboarding dialect id → the language the model should answer in.
const DIALECT_LANGUAGE = Object.freeze({
  egy:  'Egyptian Arabic',
  gulf: 'Gulf Arabic',
});

export function languageForDialect(dialect) {
  return DIALECT_LANGUAGE[dialect] ?? 'English';
}

// Format a signal for the prompt: a real value, or the honest "not available"
// so the model never sees a bare null to invent around.
function fmt(value, suffix = '') {
  return value == null ? 'not available' : `${value}${suffix}`;
}

/**
 * @param {object} c — server-resolved campaign reasoning input
 *   { name, channel, objective, verdict, impactScore, ctrPct, frequency, roas,
 *     spendSharePct, rationale, accountObjective, dialect }
 * @returns {{ system: string, user: string }}
 */
export function buildReasoningPrompt(c = {}) {
  const language = languageForDialect(c.dialect);
  const accountObjective = c.accountObjective || 'performance marketing';

  const system = `You are Lumi, a MENA performance-marketing intelligence system. You explain campaign decisions to a marketer in clear, direct, actionable language.

Respond in ${language}. Be concise — 2 to 3 sentences maximum, no preamble.
Never fabricate numbers: use ONLY the figures given below, and if a signal is "not available" do not invent one or guess a range.
Be direct — never hedge with "data suggests" or "it appears". State what is happening and what to do.
The marketer's account objective is: ${accountObjective}.`;

  const user = `Explain this campaign's performance verdict in plain language.

Campaign: ${c.name || 'Unnamed campaign'}
Channel: ${c.channel || 'not available'}
Campaign objective: ${c.objective || 'not available'}
Verdict: ${c.verdict || 'not available'}
Impact score: ${fmt(c.impactScore, '/10')}

Signals:
- CTR: ${c.ctrPct != null ? `${c.ctrPct.toFixed(2)}%` : 'not available'}
- Frequency: ${c.frequency != null ? c.frequency.toFixed(2) : 'not available'}
- ROAS: ${c.roas != null ? `${c.roas.toFixed(2)}x` : 'not measured'}
- Spend share: ${c.spendSharePct != null ? `${c.spendSharePct.toFixed(1)}% of account spend` : 'not available'}

Verdict rationale (deterministic engine): ${c.rationale || 'not available'}

Explain WHY this verdict was given and WHAT the marketer should do next, specific to this campaign's actual signals.`;

  return { system, user };
}
