// ============================================================
// metricWindow — THE CANONICAL VERDICT WINDOW CONTRACT
// ============================================================
// This module answers one question that had no answer anywhere in the codebase:
//
//     "When Lumi says KILL, what period is it talking about?"
//
// Until now the answer was "whichever sync wrote last". The daily cron requests
// `last_90d`, the manual Sync button requests `maximum` (Meta's full ~37-month
// retention), and the sync route accepts any preset string a client sends. All
// three land in one MetricSnapshot table, indistinguishable — same `source`,
// same hardcoded `granularity: 'DAILY'`, no column naming the period — and
// EntityGraphService picks between them on `date` alone. So pressing Sync
// silently re-based every verdict in the workspace until the next cron tick.
//
// That was never a decision anyone made. It was the residue of an ingestion
// policy (`connectorConfig.js`: "the trigger decides the window") that was
// written to manage Meta API load and was never asked what it implied for a
// threshold.
//
// ── THE CONTRACT ────────────────────────────────────────────────────────────
//
//   A verdict window is a PRODUCT contract, not a sync side effect.
//
//     requested ingestion window   ≠   canonical verdict window
//
// The ingestion layer stays free to request whatever is operationally useful.
// What it may no longer do is decide what a verdict MEANS.
//
// ── WHY THIS IS A CONSTANT AND NOT AN ENV VAR ───────────────────────────────
// Most tunables here read `process.env`. This one deliberately does not.
// An env-overridable verdict window would reintroduce the exact defect this
// module exists to close: the meaning of a KILL would depend on deployment
// configuration, and two environments could disagree about the same campaign
// while both looked correct. The window is a product decision, so changing it
// is a code change, a review, and a re-run of the verdict regression suite.
//
// ── STATUS: CONTRACT ONLY, NO PRODUCTION CALLER YET ─────────────────────────
// Nothing in the verdict path imports this module today, and that is deliberate,
// not an oversight. Phase D (the metric resolver) is what wires it in. Naming it
// here so this does not become one more thing that exists, is guarded, and is
// reachable by nobody — the failure class this codebase keeps finding.
//
//   Phase B (this)  contract + algebra + tests            ← no behaviour change
//   Phase C         window provenance on MetricSnapshot
//   Phase D         EntityGraph resolves BY WINDOW, not by newest row
//   Phase E         daily additive ingestion (time_increment=1)
//   Phase F         separate cumulative query for reach/frequency
//   Phase G         verdict regression — every changed verdict explained
// ============================================================

/**
 * THE canonical verdict window, in days. Product decision, 2026-08-11.
 *
 * Every verdict-bearing metric — spend, revenue, impressions, clicks,
 * conversions, and the CTR/ROAS derived from them, plus reach and frequency —
 * describes THIS period and no other.
 *
 * Chosen as a product contract, explicitly NOT inferred from `last_90d`,
 * `maximum`, Meta's retention limit, the existing threshold values, or the cron
 * schedule. None of those was ever a statement about what a verdict means.
 */
export const CANONICAL_VERDICT_WINDOW_DAYS = 30;

/**
 * The window's exact bounds, so no consumer has to invent them.
 *
 * Rolling and trailing: it ends at `now` and reaches back
 * CANONICAL_VERDICT_WINDOW_DAYS. NOT calendar-month-aligned — a verdict must
 * mean the same thing on the 3rd of the month as on the 28th, and a
 * calendar window would make Lumi most confident right before it resets.
 *
 * `start` is INCLUSIVE, `end` is INCLUSIVE. A 30-day window therefore covers 30
 * days of delivery, not 29 or 31 — the off-by-one that quietly makes two
 * consumers disagree about the same campaign.
 *
 * @param {Date|number|string} [now]
 * @returns {{ start: Date, end: Date, days: number }}
 */
export function canonicalWindowBounds(now = new Date()) {
  const end = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(end.getTime())) throw new Error('canonicalWindowBounds: invalid `now`');
  // days - 1 because both ends are inclusive: a 1-day window is [now, now].
  const start = new Date(end.getTime() - (CANONICAL_VERDICT_WINDOW_DAYS - 1) * 86_400_000);
  return { start, end, days: CANONICAL_VERDICT_WINDOW_DAYS };
}

// ── METRIC FAMILIES ─────────────────────────────────────────────────────────
// Three families with three different algebras. Treating them as one is how
// `SUM(reach)` and `AVG(daily ROAS)` become plausible-looking numbers.

export const METRIC_FAMILY = Object.freeze({
  ADDITIVE:   'ADDITIVE',   // sums over time
  DERIVED:    'DERIVED',    // a ratio of two ADDITIVE totals, computed AFTER summing
  CUMULATIVE: 'CUMULATIVE', // window-level only; NOT recoverable from daily rows
});

/**
 * Metrics that sum across days without loss. A day's spend and the next day's
 * spend are disjoint quantities, so Σ is exact.
 */
export const ADDITIVE_METRICS = Object.freeze([
  'spendMinor', 'revenueMinor', 'impressions', 'clicks', 'conversions',
]);

/**
 * Ratios. They are NOT additive and NOT averageable — they must be recomputed
 * from the summed numerator and summed denominator. Averaging daily ratios
 * weights a 100-impression day equally with a 100,000-impression one, which is
 * a number no row contains.
 */
export const DERIVED_METRICS = Object.freeze(['ctr', 'roas']);

/**
 * Metrics that CANNOT be reconstructed from daily rows by any arithmetic, and
 * must therefore come from a window-level query against the same canonical
 * window (Phase F).
 */
export const CUMULATIVE_METRICS = Object.freeze(['reach', 'frequency']);

/**
 * WHY each cumulative metric is non-reconstructible. Exported as data rather
 * than left in a comment so an error path or a UI can state the real reason
 * instead of "unavailable".
 */
export const NON_AGGREGABLE_REASON = Object.freeze({
  reach: 'reach counts UNIQUE people. Someone reached on Monday and again on Tuesday is one person, '
       + 'and a daily row carries no identity to deduplicate by — so Σ(daily reach) overstates the '
       + 'true window reach by however much the audience overlaps.',
  frequency: 'frequency is window impressions ÷ window UNIQUE reach. Σ(daily frequency) is not a '
           + 'frequency at all, and mean(daily frequency) is the average DAILY frequency — a '
           + 'different, always-smaller quantity than the window frequency the fatigue ceiling judges.',
});

/** The family a metric belongs to, or null if this contract does not classify it. */
export function metricFamily(metric) {
  if (ADDITIVE_METRICS.includes(metric)) return METRIC_FAMILY.ADDITIVE;
  if (DERIVED_METRICS.includes(metric)) return METRIC_FAMILY.DERIVED;
  if (CUMULATIVE_METRICS.includes(metric)) return METRIC_FAMILY.CUMULATIVE;
  return null;
}

/**
 * Can this metric be honestly reconstructed by aggregating daily rows?
 * ADDITIVE and DERIVED: yes. CUMULATIVE: no — see NON_AGGREGABLE_REASON.
 * An unclassified metric returns false: this contract does not vouch for it.
 */
export function canAggregateFromDaily(metric) {
  const family = metricFamily(metric);
  return family === METRIC_FAMILY.ADDITIVE || family === METRIC_FAMILY.DERIVED;
}

// ── THE AGGREGATION ALGEBRA ─────────────────────────────────────────────────

/**
 * Σ the additive metrics across rows already filtered to the canonical window.
 *
 * Returns `null` — not a zero-filled object — when there are no rows. An
 * account with no delivery in the window has NO measurement, and a zeroed total
 * is indistinguishable from a campaign that genuinely spent nothing. The caller
 * decides how to say "no data"; this function refuses to say "zero".
 *
 * Does NOT touch reach or frequency even if the rows carry them. Summing those
 * is the defect (NON_AGGREGABLE_REASON), so this function is simply incapable
 * of it rather than trusting every caller to remember.
 *
 * @param {Array<object>} rows — daily MetricSnapshot rows within the window
 * @returns {{spendMinor,revenueMinor,impressions,clicks,conversions}|null}
 */
export function sumAdditive(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = {};
  for (const key of ADDITIVE_METRICS) out[key] = 0;
  for (const r of rows) {
    if (!r) continue;
    for (const key of ADDITIVE_METRICS) {
      const v = r[key];
      if (Number.isFinite(v)) out[key] += v;
    }
  }
  return out;
}

/**
 * CTR as a PERCENT, from the SUMMED numerator and denominator.
 * Matches the unit verdictEngine.toSignalInput already produces (clicks ÷
 * impressions × 100), so Phase D swapping this in cannot silently change scale.
 *
 * null when impressions were never measured — a rate off zero impressions is
 * undefined, not 0%. (toSignalInput currently yields 0 there; that divergence
 * is deliberate and is resolved in Phase D, not silently here.)
 */
export function deriveCtr(clicks, impressions) {
  if (!Number.isFinite(clicks) || !Number.isFinite(impressions) || impressions <= 0) return null;
  return (clicks / impressions) * 100;
}

/**
 * ROAS from the SUMMED revenue and SUMMED spend.
 *
 * null unless BOTH are positive — the same `revenueMeasured` rule
 * verdictEngine.toSignalInput uses today, kept identical on purpose. A row whose
 * revenue was never measured carries a real 0, and dividing it would fabricate
 * a 0.00× ROAS that reads as catastrophic performance rather than as absent
 * data. That is the exact class PR #96 removed from the display.
 */
export function deriveRoas(revenueMinor, spendMinor) {
  if (!Number.isFinite(revenueMinor) || !Number.isFinite(spendMinor)) return null;
  if (revenueMinor <= 0 || spendMinor <= 0) return null;
  return revenueMinor / spendMinor;
}

// ── ACTUAL-REVENUE OVERLAY ──────────────────────────────────────────────────

/**
 * May an actual-source revenue figure (GA4 / Shopify / MANUAL) be divided by a
 * platform spend figure to produce a ROAS?
 *
 * Only when BOTH describe the same canonical window. Today `effectiveByEntity`
 * overlays the latest actual revenue onto the latest platform row and re-derives
 * ROAS across whatever two windows those happen to be, bounded only by
 * REVENUE_MAX_AGE_DAYS (90) — which limits the drift rather than removing it.
 *
 * NO CROSS-WINDOW ROAS. A blended ROAS whose numerator covers one period and
 * denominator another is not a measurement of anything.
 *
 * @returns {boolean} true only when both windows are given and identical
 */
export function sameWindow(a, b) {
  if (!a || !b) return false;
  const t = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
  const [as, ae, bs, be] = [t(a.start), t(a.end), t(b.start), t(b.end)];
  if ([as, ae, bs, be].some((n) => !Number.isFinite(n))) return false;
  return as === bs && ae === be;
}
