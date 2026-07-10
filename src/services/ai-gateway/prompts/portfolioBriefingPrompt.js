// ============================================================
// AI Gateway — portfolio briefing prompt (GENERATE_BRIEFING)
// ============================================================
// Builds the {system, user} prompt for a 1-2 sentence portfolio state summary.
// Generated in the sweep (best-effort), stored in LoopRun.aiInsight, surfaced on
// Overview. Deterministic stats + LLM prose synthesis.
//
// HONESTY RULES baked into the prompt:
//   - Every value is a REAL stat from connector campaigns via the verdict engine.
//   - The system prompt forbids fabricating numbers and demands directness.
//   - Max 30 words — this is an insight card, not a report.
//
// LANGUAGE:
//   English only (internal operator decision-support surface).
// ============================================================

/**
 * @param {object} stats — server-computed portfolio stats
 *   { total, kill, refresh, watch, hold, scale, healthScore, healthLabel,
 *     wastedPct, awarenessCount, conversionNoRevenueCount }
 * @param {object} workspace — { objective }
 * @returns {{ system: string, user: string }}
 */
export function buildPortfolioBriefingPrompt(stats = {}, workspace = {}) {
  const objective = workspace.objective || 'performance';

  const system = `You are Lumi, a MENA marketing intelligence system.
Write one sentence (max 30 words) summarizing the account state.
Be direct. Use numbers. Never say "I" or "Lumi". Never fabricate.
Language: English.`;

  const user = `Account state:
- Total campaigns: ${stats.total ?? 0}
- Verdict breakdown: ${stats.kill ?? 0} KILL · ${stats.refresh ?? 0} REFRESH · ${stats.watch ?? 0} WATCH · ${stats.hold ?? 0} HOLD · ${stats.scale ?? 0} SCALE
- Account Health: ${stats.healthScore ?? 0}/100 (${stats.healthLabel || 'not scored'})
- Wasted spend: ${stats.wastedPct ?? 0}% of total
- Awareness campaigns: ${stats.awarenessCount ?? 0}
- Conversion campaigns without revenue: ${stats.conversionNoRevenueCount ?? 0}
- Workspace objective: ${objective}

Write one direct, numbers-first sentence summarizing what this account needs most right now.`;

  return { system, user };
}
