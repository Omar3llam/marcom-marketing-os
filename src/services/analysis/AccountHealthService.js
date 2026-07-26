// ============================================================
// AccountHealthService — deterministic account analysis
// ============================================================
// Three numbers, all traceable to real MetricSnapshot rows via the verdict
// engine, none fabricated:
//   1. Wasted Spend — spend on campaigns the engine says to KILL or REFRESH.
//   2. Account Health (0-100) — spend-weighted roll-up of per-campaign health.
//   3. Impact Score (1-10) per campaign — how much acting on it matters now.
//
// DETERMINISM CONTRACT (mirrors DiagnosisEngine / VerdictEngine):
//   Pure. Same input → same output. No randomness, no LLM, no DB, no clock.
//   The caller (routes/lumi/entities.js) owns the I/O and passes rows in.
//
// WHY WE DON'T CALL diagnoseSignals HERE:
//   The verdict is ALREADY the diagnosis result — verdictEngine.evaluateVerdict
//   runs diagnoseSignals(metrics) internally. Re-running it would be redundant
//   double-work AND diagnoseSignals REQUIRES cpc+cpm (which MetricSnapshot does
//   not store) and THROWS on the null fields connector rows routinely carry.
//   So health/impact derive from the verdict + the raw ctr/frequency/spend the
//   rows do carry. This keeps the service currency-agnostic: every input is a
//   ratio (spend SHARE, ctr %, frequency) or a minor-unit sum, so no cpc/cpm
//   derivation and no currency conversion is needed. Display-time conversion
//   (minor → major) happens once, at the client boundary.
// ============================================================

// Currency-relative thresholds — ratios/percentages, never USD absolutes, so
// they hold identically for an EGP or KWD account as for USD.
const THRESHOLDS = Object.freeze({
  SPEND_FLOOR_PCT: 0.01, // a campaign must be ≥ 1% of account spend to be scored
  FREQ_HIGH:       3.5,  // heavy saturation (matches the verdict engine's fatigue floor)
  FREQ_ELEVATED:   3.0,  // mild saturation
  CTR_STRONG_PCT:  2.0,  // % — a strong hook
  CTR_WEAK_PCT:    0.5,  // % — a weak hook
});

// Verdicts whose spend counts as WASTED. KILL = stop entirely; REFRESH = the
// creative is fatigued and the money is increasingly burning. REALLOCATE is
// productive-but-misplaced budget (moved, not wasted) → deliberately excluded.
export const WASTED_VERDICTS = Object.freeze(new Set(['KILL', 'REFRESH']));

// Per-campaign health base by verdict (0-100). Exhaustive over the VERDICT enum
// (verdict-engine/verdictTypes.js): KILL/HOLD/SCALE/WATCH/REALLOCATE/REFRESH.
const HEALTH_BASE = Object.freeze({
  SCALE: 85, HOLD: 60, WATCH: 45, REALLOCATE: 40, REFRESH: 30, KILL: 10,
});

// Per-campaign impact base by verdict (1-10) — "how much does acting matter?".
// KILL (stop the bleed) is most urgent; SCALE (already winning) least.
const IMPACT_BASE = Object.freeze({
  KILL: 9, REFRESH: 7, REALLOCATE: 7, WATCH: 6, HOLD: 4, SCALE: 2,
});

/**
 * Per-campaign health score (0-100): verdict base, adjusted for fatigue + hook.
 * @param {string|null} verdict
 * @param {number} ctrPct  — CTR already in percent (fraction × 100)
 * @param {number|null} frequency
 */
export function verdictToHealthScore(verdict, ctrPct, frequency) {
  const base = HEALTH_BASE[verdict] ?? 50; // unknown/absent verdict → neutral
  const freqPenalty = frequency > THRESHOLDS.FREQ_HIGH ? -10
    : frequency > THRESHOLDS.FREQ_ELEVATED ? -5 : 0;
  const ctrAdj = ctrPct > THRESHOLDS.CTR_STRONG_PCT ? 5
    : ctrPct < THRESHOLDS.CTR_WEAK_PCT ? -10 : 0;
  return Math.max(0, Math.min(100, base + freqPenalty + ctrAdj));
}

/**
 * Per-campaign impact score (1-10): verdict severity, weighted by spend share,
 * nudged up when a conversion campaign is bleeding (roas < 1).
 * @param {object} args
 * @param {string|null} args.verdict
 * @param {number} args.spendShare — this campaign's spend / account spend (0..1)
 * @param {number|null} args.roas
 */
export function computeImpactScore({ verdict, spendShare, roas }) {
  const base = IMPACT_BASE[verdict] ?? 5;
  // Bigger share of the account = a bigger lever → weights impact up.
  const spendMultiplier = spendShare > 0.2 ? 1 : spendShare > 0.1 ? 0.8 : 0.6;
  const roasAdj = roas != null && roas < 1.0 ? 1 : 0;
  return Math.min(10, Math.max(1, Math.round(base * spendMultiplier + roasAdj)));
}

/** Human label for an account health score. */
export function healthLabel(score) {
  if (score >= 80) return 'HEALTHY';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'FAIR';
  if (score >= 20) return 'NEEDS ATTENTION';
  return 'CRITICAL';
}

/**
 * Compute deterministic account analysis from live connector campaigns + their
 * verdicts. PURE — no I/O.
 *
 * @param {Array<object>} campaigns — rows from getConnectorCampaigns
 *   (each: { entityId, name, spendMinor, ctr(fraction), frequency, roas, ... })
 * @param {Record<string, {verdict:string, roas:number|null}>} verdictMap
 *   — keyed by entityId (built by the route from getConnectorVerdicts)
 * @returns {null | {
 *   score: number, label: string,
 *   wastedSpend: { minor: number, pct: number },
 *   campaigns: Array<{ entityId, name, impactScore, verdict }>
 * }}  — null (never 0) when there is nothing honest to score.
 *
 * `name` is inert passthrough (never scored) so a health row is identifiable on
 * its own — the Overview renders these rows directly and has no other name join.
 */
export function computeAccountHealth(campaigns, verdictMap = {}) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return null;

  const accountSpendMinor = campaigns.reduce((sum, c) => sum + (c.spendMinor ?? 0), 0);
  if (accountSpendMinor <= 0) return null; // no real spend → honest null, never 0

  const floor = accountSpendMinor * THRESHOLDS.SPEND_FLOOR_PCT;
  const scored = [];

  for (const c of campaigns) {
    const spend = c.spendMinor ?? 0;
    if (spend < floor) continue; // too small to move the account — skip from scoring

    const ctrPct = (c.ctr ?? 0) * 100;        // stored fraction → percent
    const frequency = c.frequency ?? null;
    // No engagement signal at all (no CTR and no frequency) → not enough to score.
    if (ctrPct === 0 && !frequency) continue;

    const verdict = verdictMap[c.entityId]?.verdict ?? null;
    const roas = c.roas ?? null;

    scored.push({
      entityId: c.entityId,
      name: c.name ?? null,
      spendMinor: spend,
      verdict,
      healthScore: verdictToHealthScore(verdict, ctrPct, frequency),
      impactScore: computeImpactScore({ verdict, spendShare: spend / accountSpendMinor, roas }),
    });
  }

  if (scored.length === 0) return null;

  // Account health = spend-weighted mean of per-campaign health.
  const scoredSpend = scored.reduce((s, c) => s + c.spendMinor, 0);
  const weighted = scored.reduce((sum, c) => sum + c.healthScore * (c.spendMinor / scoredSpend), 0);
  const score = Math.round(weighted);

  // Wasted spend is summed over EVERY campaign (not just the scored subset): a
  // tiny KILL campaign below the scoring floor is still wasted money.
  const wastedSpendMinor = campaigns.reduce((sum, c) => {
    const v = verdictMap[c.entityId]?.verdict;
    return WASTED_VERDICTS.has(v) ? sum + (c.spendMinor ?? 0) : sum;
  }, 0);

  return {
    score,
    label: healthLabel(score),
    wastedSpend: {
      minor: wastedSpendMinor,
      pct: Math.round((wastedSpendMinor / accountSpendMinor) * 100),
    },
    campaigns: scored.map((c) => ({
      entityId: c.entityId, name: c.name, impactScore: c.impactScore, verdict: c.verdict,
    })),
  };
}
