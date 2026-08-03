// ============================================================
// benchmarkProvider — objective-aware performance benchmarks
// ============================================================
// Public API: getBenchmarks(objective)
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no time, no randomness.
//
// WHY THIS EXISTS:
//   The engine judged every campaign against ONE global CTR floor (0.5%),
//   regardless of what the campaign was trying to do. A 0.9% CTR is weak for
//   lead gen and strong for awareness — calling both "weak hook" produces a
//   REFRESH on a campaign that is performing exactly as its objective implies.
//   The objective was already threaded into the verdict path (revenueExpectedFor
//   reads it); this makes the thresholds read it too.
//
// EXTENSIBILITY:
//   The signature is `getBenchmarks(objective)` and callers must treat the
//   returned object as opaque. A later revision can widen it to
//   `getBenchmarks(objective, { industry, accountHistory })` — account-relative
//   benchmarks are strictly better than industry constants, per the domain
//   model's "CTR vs account average (more reliable than industry)" — without any
//   caller changing. That is why this is a function and not an exported table.
//
// HONESTY:
//   A null threshold means "not applicable to this objective", NOT zero. An
//   awareness campaign has no add-to-cart rate to miss; a rule that reads null as
//   0 would fire a checkout diagnosis on a reach campaign. Callers must check for
//   null before comparing.
// ============================================================

// ctr    — percent, matching the engine's signal-input units (clicks/impr × 100)
// atcRate — add-to-cart ÷ landing-page-view, ratio
// lpvRate — landing-page-view ÷ clicks, ratio. The gap between a click and a
//           page view is pure leakage (slow page, broken redirect, dead pixel),
//           so the floor is high for every objective that has a landing page.
const BENCHMARKS = Object.freeze({
  OUTCOME_LEADS:      Object.freeze({ ctr: Object.freeze({ weak: 1.0, strong: 2.5 }), atcRate: null, lpvRate: 0.65 }),
  OUTCOME_SALES:      Object.freeze({ ctr: Object.freeze({ weak: 0.8, strong: 1.5 }), atcRate: 0.03, lpvRate: 0.60 }),
  OUTCOME_AWARENESS:  Object.freeze({ ctr: Object.freeze({ weak: 0.5, strong: 1.0 }), atcRate: null, lpvRate: null }),
  OUTCOME_ENGAGEMENT: Object.freeze({ ctr: Object.freeze({ weak: 1.5, strong: 3.0 }), atcRate: null, lpvRate: null }),
  DEFAULT:            Object.freeze({ ctr: Object.freeze({ weak: 0.8, strong: 1.5 }), atcRate: 0.03, lpvRate: 0.60 }),
});

// Legacy objective names Meta still returns on older campaigns, mapped onto the
// OUTCOME_* band that means the same thing. Without this a long-running account
// silently falls to DEFAULT — i.e. e-commerce thresholds on a REACH campaign,
// which is the exact misjudgement this module exists to stop.
const LEGACY_ALIASES = Object.freeze({
  BRAND_AWARENESS: 'OUTCOME_AWARENESS',
  REACH:           'OUTCOME_AWARENESS',
  VIDEO_VIEWS:     'OUTCOME_AWARENESS',
  POST_ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
  PAGE_LIKES:      'OUTCOME_ENGAGEMENT',
  EVENT_RESPONSES: 'OUTCOME_ENGAGEMENT',
  LINK_CLICKS:     'OUTCOME_TRAFFIC',
  LEAD_GENERATION: 'OUTCOME_LEADS',
  CONVERSIONS:     'OUTCOME_SALES',
  PRODUCT_CATALOG_SALES: 'OUTCOME_SALES',
  // Traffic has a landing page but no cart — leads thresholds fit it better than
  // sales, but its CTR expectation is its own.
  OUTCOME_TRAFFIC: 'OUTCOME_TRAFFIC',
});

// Traffic gets its own band rather than an alias target: link-click optimisation
// buys cheap, high-volume clicks, so its CTR bar is higher than sales and its
// funnel stops at the landing page.
const TRAFFIC = Object.freeze({ ctr: Object.freeze({ weak: 1.0, strong: 2.0 }), atcRate: null, lpvRate: 0.60 });

/**
 * Benchmarks for a platform objective.
 *
 * @param {string|null} objective — Meta objective (OUTCOME_SALES, REACH, …).
 *   Unknown or null falls to DEFAULT: we never throw on an objective we have not
 *   seen, because a new Meta objective must not break a sync, and we never leave
 *   the caller without thresholds to compare against.
 * @returns {{ ctr: { weak: number, strong: number }, atcRate: number|null, lpvRate: number|null }}
 */
export function getBenchmarks(objective) {
  if (objective == null) return BENCHMARKS.DEFAULT;
  const key = String(objective).toUpperCase();
  if (BENCHMARKS[key]) return BENCHMARKS[key];
  const aliased = LEGACY_ALIASES[key];
  if (aliased === 'OUTCOME_TRAFFIC') return TRAFFIC;
  if (aliased && BENCHMARKS[aliased]) return BENCHMARKS[aliased];
  return BENCHMARKS.DEFAULT;
}

/**
 * The audience-saturation ceiling: past this many impressions per person, the
 * audience has seen the creative too often for the click-through to be read as
 * creative quality.
 *
 * It lives HERE rather than in verdictEngine because the verdict engine and the
 * diagnosis engine must judge frequency by the same number, and the diagnosis
 * engine cannot import verdictEngine — verdictEngine imports diagnoseSignals, so
 * that edge would close a cycle. benchmarkProvider imports nothing, which is
 * exactly what makes it a safe shared home. Two ceilings previously existed
 * (3.0 in signalRules, 3.5 in verdictEngine) and the two engines disagreed about
 * the same ad.
 *
 * Not objective-varying today. If it ever becomes so it belongs in BENCHMARKS
 * alongside the CTR bars, and every reader already goes through this module.
 */
export const FATIGUE_FREQ = 3.5;

/** The raw table, exported for tests and audit. Frozen — never mutate. */
export { BENCHMARKS };
