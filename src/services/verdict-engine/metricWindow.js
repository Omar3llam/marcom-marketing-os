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
//   Phase B ✅      contract + algebra + tests            ← no behaviour change
//   Phase C ✅      window provenance on MetricSnapshot   (measurementWindow)
//   Phase D ◐       the canonical resolver — BUILT BELOW, deliberately NOT wired
//   Phase E         daily additive ingestion (time_increment=1)
//   Phase F ✅      cumulative 30d ingestion — the first CUMULATIVE_30D producer
//   Phase G ✅      isolate the pre-existing readers from the canonical population
//   Phase H ✅      resolve what an ACTUAL-source measurement means
//   Phase I         verdict regression — every changed verdict explained
//
// Phase D is half-done ON PURPOSE, and the reason has changed twice:
//
//   WAS (pre-Phase-F): no producer emitted a CUMULATIVE_30D row, so wiring the
//   resolver in would have resolved NO_CANONICAL_WINDOW everywhere and taken the
//   verdict surface dark.
//
//   NOW: Phase F produces canonical Meta rows and Phase H has established what
//   every revenue source can and cannot prove about itself. Meta's PLATFORM
//   revenue is canonical; the ACTUAL revenue that overrides it (GA4 / MANUAL) is
//   not, and cannot become so without attribution configuration Lumi does not hold and a
//   product decision nobody has made. See ACTUAL_SOURCE_CONTRACT below — the
//   remaining blocker is now stated per source, with the exact missing facts.
//
// See the resolution section at the bottom of this file.
// ============================================================
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

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

// ── THE PHASE D ACTIVATION GATE ─────────────────────────────────────────────
//
// Phase D activation is BLOCKED until actual-source canonical 30-day semantics
// are defined. This is a PRODUCT SEQUENCING decision, so it is a constant here —
// deliberately not an env var, not a feature flag, and not settable at deploy.
// Turning it on is a code change, a review, and this file's test suite.
//
// WHY IT IS BLOCKED
//
// Activating the resolver makes Meta spend a canonical 30-day measurement. The
// revenue divided BY that spend often does not come from Meta at all:
// effectiveByEntity overlays the latest GA4 / Shopify / MANUAL revenue onto the
// platform row and re-derives ROAS. New GA4 rows may now carry an exact period;
// legacy GA4 and manual rows remain unknown, and GA4 attribution semantics still
// prevent canonical use. Dividing incompatible periods is the cross-window ROAS
// sameWindow() exists to forbid: a ratio whose numerator covers one period and
// whose denominator covers another is not a measurement of anything.
//
// The alternative — dropping the overlay — is not a neutral default either. It
// is a product capability change: every account whose ROAS comes from a revenue
// upload or GA4 loses ROAS at the moment of activation.
//
// Neither branch may be chosen by an implementer. Both are Omar's call.
//
// WHAT WOULD UNBLOCK IT — the exact facts that are missing, per source. Recorded
// as DATA rather than prose so a future phase cannot quietly satisfy the gate by
// re-reading an ambiguous comment charitably.
export const WINDOW_FACT = Object.freeze({
  KNOWN: 'KNOWN',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

/**
 * Can each revenue source state the period it measured? Every UNKNOWN below was
 * established by reading the ingestion path, not inferred from naming.
 *
 * META — canonical since Phase F. fetchCanonicalCampaignInsights sends an
 *   explicit time_range and metaNormalize lands Meta's own date_start/date_stop,
 *   so the row carries a real, corroborated period. Attribution is not a separate
 *   axis here: the platform reports conversions already attributed under the ad
 *   account's own setting, inside the window it was asked for.
 *
 * GA4 — new reports carry their requested range and the response property's
 *   time zone through normalization, into exact UTC bounds on the snapshot.
 *   Older rows are not reconstructed; responses missing that proof stay UNKNOWN.
 *   The request still depends on the sync trigger's preset. Attribution remains
 *   unrecorded: the report is
 *   built on sessionSource / sessionMedium / sessionCampaignName, which are
 *   resolved by the GA4 PROPERTY's own attribution model and lookback window —
 *   configuration that lives in Google's UI, is not read by this codebase, and
 *   can be changed without Lumi observing it. Two GA4 rows pulled under different
 *   lookbacks are byte-identical here.
 *
 * MANUAL (revenue CSV) — the upload carries no period at all. The row shape is
 *   { campaignIdentifier, revenueAmount, conversions?, currency? }; the `date`
 *   stored is BORROWED from the latest platform snapshot's sync timestamp
 *   (RevenueCsvService), which is not a measurement date and was never claimed to
 *   be one. Whether the figure is incremental or cumulative is not asked and not
 *   inferable.
 */
export const ACTUAL_SOURCE_WINDOW_FACTS = Object.freeze({
  META: Object.freeze({
    measurementStart: WINDOW_FACT.KNOWN,
    measurementEnd: WINDOW_FACT.KNOWN,
    attributionLookback: WINDOW_FACT.NOT_APPLICABLE,
    persisted: WINDOW_FACT.KNOWN,
    canBeCanonical: true,
  }),
  GA4: Object.freeze({
    measurementStart: WINDOW_FACT.KNOWN, // new reports with valid response time zone only
    measurementEnd: WINDOW_FACT.KNOWN,
    attributionLookback: WINDOW_FACT.UNKNOWN,
    persisted: WINDOW_FACT.KNOWN,
    canBeCanonical: false,
  }),
  MANUAL: Object.freeze({
    measurementStart: WINDOW_FACT.UNKNOWN,
    measurementEnd: WINDOW_FACT.UNKNOWN,
    attributionLookback: WINDOW_FACT.UNKNOWN,
    persisted: WINDOW_FACT.UNKNOWN,
    canBeCanonical: false,
  }),
  SHOPIFY: Object.freeze({
    // No producer exists. actualsSink accepts the source; nothing writes it.
    measurementStart: WINDOW_FACT.UNKNOWN,
    measurementEnd: WINDOW_FACT.UNKNOWN,
    attributionLookback: WINDOW_FACT.UNKNOWN,
    persisted: WINDOW_FACT.UNKNOWN,
    canBeCanonical: false,
  }),
});

/**
 * THE GATE. False until every ACTUAL revenue source can state the period it
 * measured — which today still means GA4's attribution model and
 * lookback, and the revenue CSV's measurement period, are defined as product
 * semantics and persisted on the row.
 *
 * Flipping this to true is not sufficient to activate Phase D; it only removes
 * the block. It must be flipped in the same change that makes the facts above
 * KNOWN, never ahead of it.
 */
export const ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED = false;

/**
 * May an ACTUAL-source revenue row be used as the numerator of a verdict ROAS
 * whose denominator is canonical spend?
 *
 * This is the single predicate the gate protects. It is deliberately stricter
 * than sameWindow(): even an actual row with proved bounds may lack the
 * attribution contract required for canonical verdict ROAS. This says WHY.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function actualRevenueEligibleForCanonicalRoas(actualRow) {
  // The SOURCE must be allowed to be canonical at all (Phase H) before the ROW
  // is examined. Checked first and separately: a GA4 row could one day carry a
  // perfectly well-formed 30-day period and still not be canonical, because the
  // period is not what is missing — the attribution semantics behind the number
  // are. Collapsing these two checks is how "it spans 30 days" quietly becomes
  // "it measures the canonical window".
  //
  // NOTE the deliberate omission: this does NOT consult
  // ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED. That flag gates ACTIVATION, and
  // routing this predicate through it would make every rule below unreachable —
  // the contract would be a thing that exists, is guarded, and is evaluated by
  // nobody, which is the failure class this repository keeps rediscovering. The
  // predicate answers "is this row canonical revenue"; the flag answers "may
  // Phase D switch on". Two questions, two answers.
  const contract = sourceContract(actualRow?.source);
  if (contract.verdict !== SOURCE_CONTRACT.CANONICAL) {
    return { ok: false, reason: 'SOURCE_NOT_CANONICAL', source: actualRow?.source ?? null, detail: contract };
  }
  const verdict = canonicalEligibility(actualRow);
  return verdict.ok ? { ok: true, reason: null } : { ok: false, reason: verdict.reason };
}

// ── PHASE H: THE ACTUAL-SOURCE CONTRACT ─────────────────────────────────────
//
// Phase H asked one question of each revenue source:
//
//     can this number prove it measures the SAME 30 days the canonical Meta
//     spend measures, under semantics we can state?
//
// The answers below are derived from the ingestion code, not from naming, not
// from what a source could in principle report, and not from what would be
// convenient. Where the answer is no, what is MISSING is recorded — because the
// useful output of this phase is not "unavailable", it is "unavailable, and here
// is precisely what would change that".

export const SOURCE_CONTRACT = Object.freeze({
  // Enough persisted evidence to establish a 30-day measurement AND compatible
  // semantics. May participate in canonical ROAS.
  CANONICAL: 'CANONICAL',
  // Lacks the evidence and has no path to it as things stand. May continue to
  // serve non-canonical surfaces; may not produce canonical ROAS.
  NON_CANONICAL: 'NON_CANONICAL',
  // Could become canonical, but only via a product decision or configuration
  // that Lumi does not currently control or persist.
  BLOCKED: 'BLOCKED',
});

/**
 * Per-source verdicts, with the evidence each conclusion rests on.
 *
 * `missing` is the exact list of facts that would have to become persisted and
 * true. `historicalRecoverable: false` everywhere non-canonical is not caution —
 * it is Phase C's principle: provenance that was never recorded cannot be
 * reconstructed later from a row date, an upload time, or the preset that
 * happened to be configured when the sync ran.
 */
export const ACTUAL_SOURCE_CONTRACT = Object.freeze({
  META: Object.freeze({
    verdict: SOURCE_CONTRACT.CANONICAL,
    evidence: 'fetchCanonicalCampaignInsights sends an explicit time_range built from '
            + 'canonicalWindowBounds, and metaNormalize lands Meta\'s own date_start/date_stop — so the row '
            + 'carries a real period that canonicalEligibility corroborates against the declaration. '
            + 'Attribution is not a separate axis: the platform reports conversions already attributed '
            + 'under the ad account\'s setting, inside the window it was asked for.',
    missing: Object.freeze([]),
    historicalRecoverable: false, // pre-Phase-F rows stay LEGACY_UNKNOWN / ROLLING_WINDOW
  }),

  GA4: Object.freeze({
    verdict: SOURCE_CONTRACT.BLOCKED,
    evidence: 'New GA4 observations preserve exact UTC bounds derived from the requested date range '
            + 'and response metadata.timeZone; legacy and unproven reports remain unknown. Canonical '
            + 'use remains blocked by ATTRIBUTION: buildRunReportBody requests sessionSource/sessionMedium/sessionCampaignName '
            + 'with purchaseRevenue/transactions and specifies NO attribution model and NO lookback — those '
            + 'are resolved by the GA4 PROPERTY\'s own settings, which live in Google\'s UI, are never read '
            + 'here, and can change without Lumi observing it. marcom_credentials persists platform, '
            + 'account_id, tokens, scopes and health; no attribution configuration of any kind.',
    missing: Object.freeze([
      'the property attribution model in force when the number was produced',
      'the acquisition/conversion lookback window in force when the number was produced',
      'a product decision that GA4-attributed revenue is comparable to Meta-attributed spend at all',
    ]),
    historicalRecoverable: false,
  }),

  MANUAL: Object.freeze({
    verdict: SOURCE_CONTRACT.BLOCKED,
    evidence: 'The upload carries no period, and there is nowhere for one to enter. RevenueCsvTab maps '
            + 'exactly three columns — identifier, revenue, conversions — plus a currency selector; '
            + 'POST /api/lumi/revenue/csv accepts { rows } and validates only length; and '
            + 'RevenueCsvService stores `date: latest.date`, BORROWED from the newest platform snapshot\'s '
            + 'SYNC timestamp. A period column in the user\'s file is never mapped, never sent, never stored. '
            + 'Whether the figure is incremental or cumulative is not asked, and whether any attribution was '
            + 'applied before the human typed it is unknowable by construction.',
    missing: Object.freeze([
      'a measurement period on the upload — UI mapping, request payload, and a persisted column',
      'a declaration of whether the revenue is incremental or cumulative over that period',
      'a product decision on what a hand-supplied revenue figure attributes to',
    ]),
    historicalRecoverable: false,
  }),

  SHOPIFY: Object.freeze({
    verdict: SOURCE_CONTRACT.NON_CANONICAL,
    evidence: 'No producer exists. actualsSink.assertActuals accepts the tag and BlendedTruthService lists '
            + 'it among ACTUAL_SOURCES, but no connector, normalizer or route writes a SHOPIFY row — so there '
            + 'is no ingestion path whose semantics could be established. Recorded rather than omitted so a '
            + 'future Shopify connector inherits the question instead of the tag.',
    missing: Object.freeze(['a producer']),
    historicalRecoverable: false,
  }),
});

/** The contract for a source. An unrecognised source is NON_CANONICAL, never assumed. */
export function sourceContract(source) {
  return ACTUAL_SOURCE_CONTRACT[source] ?? Object.freeze({
    verdict: SOURCE_CONTRACT.NON_CANONICAL,
    evidence: 'unrecognised source — this contract does not vouch for it',
    missing: Object.freeze(['a contract entry']),
    historicalRecoverable: false,
  });
}

/**
 * THE CROSS-SOURCE RULE. May these two rows form a canonical verdict ROAS?
 *
 * Both must be canonical in their own right AND measure the same period. The
 * same-period check is not redundant with the eligibility checks: two rows can
 * each be a valid canonical 30-day measurement of DIFFERENT 30 days — one synced
 * today and one a week ago — and dividing those is exactly the cross-window
 * ratio this whole track exists to prevent.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function canonicalRoasPair(revenueRow, spendRow) {
  if (!revenueRow || !spendRow) return { ok: false, reason: 'MISSING_ROW' };

  const revenue = actualRevenueEligibleForCanonicalRoas(revenueRow);
  if (!revenue.ok) return { ok: false, reason: revenue.reason };

  const spend = canonicalEligibility(spendRow);
  if (!spend.ok) return { ok: false, reason: spend.reason };

  if (!sameWindow(
    { start: revenueRow.windowStart, end: revenueRow.windowEnd },
    { start: spendRow.windowStart, end: spendRow.windowEnd },
  )) {
    return { ok: false, reason: 'CROSS_WINDOW' };
  }
  return { ok: true, reason: null };
}

// ════════════════════════════════════════════════════════════
// CANONICAL WINDOW RESOLUTION (Phase D)
// ------------------------------------------------------------
// The selection rule that makes "30-day verdict" real rather than a label.
//
// What it replaces: EntityGraphService → effectiveByEntity → latestOf(), which
// picks on max(`date`) — the SYNC timestamp. Under that rule a `maximum` row
// beats a `last_90d` row for no reason other than a human having clicked Sync
// more recently, and the verdict silently re-bases.
//
// THE ONE RULE THIS EXISTS TO ENFORCE: there is no fallback. A 90-day aggregate
// cannot be reduced to a 30-day one — the information is not in the row — so
// when no canonical snapshot exists the answer is NO_CANONICAL_WINDOW, never the
// nearest available row. `canonical ?? latest90d` would recreate the entire
// defect in one line.
//
// STATUS: NOT WIRED INTO THE VERDICT PATH. Nothing produces CUMULATIVE_30D rows
// yet (Phase F is the cumulative ingestion), so activating this today would
// resolve NO_CANONICAL_WINDOW for every entity in every workspace and take the
// whole verdict surface dark. Implemented, tested, and left cold on purpose.
// ════════════════════════════════════════════════════════════

/** Outcome of a resolution attempt for one stream. */
export const RESOLUTION = Object.freeze({
  OK: 'OK',
  NO_CANONICAL_WINDOW: 'NO_CANONICAL_WINDOW',
});

/**
 * Why a candidate row was refused. Reported, never repaired — a resolver that
 * "fixes" a malformed period is guessing, and the guess is invisible afterwards.
 */
export const REJECTION = Object.freeze({
  NOT_CANONICAL:       'NOT_CANONICAL',       // DAILY / ROLLING_WINDOW / LEGACY_UNKNOWN
  MISSING_PERIOD:      'MISSING_PERIOD',      // declared canonical, reported no dates
  MALFORMED_PERIOD:    'MALFORMED_PERIOD',    // start after end
  FUTURE_PERIOD:       'FUTURE_PERIOD',       // ends after now
  PROVENANCE_MISMATCH: 'PROVENANCE_MISMATCH', // declared canonical, dates say otherwise
});

const DAY_MS = 86_400_000;
const ms = (d) => {
  const t = d == null ? NaN : (d instanceof Date ? d.getTime() : new Date(d).getTime());
  return Number.isFinite(t) ? t : null;
};

/** Inclusive day count of a period: [Aug 1, Aug 30] is 30 days, not 29. */
export function inclusiveDays(start, end) {
  const [s, e] = [ms(start), ms(end)];
  if (s == null || e == null) return null;
  return Math.round((e - s) / DAY_MS) + 1;
}

/**
 * The UTC calendar day an instant falls in, as an integer index from the epoch.
 * Exact integer arithmetic — no rounding, and therefore no threshold to sit on.
 */
const utcDayIndex = (t) => Math.floor(t / DAY_MS);

/**
 * Inclusive day count over UTC CALENDAR DAYS, not over elapsed milliseconds.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM inclusiveDays (B5 F-14 / F-15) ──────────
 * `inclusiveDays` measures a DURATION and rounds it. That is the right tool for
 * a period whose two boundaries share a precision, and the wrong one for a
 * canonical row, whose boundaries routinely do not:
 *
 *   • metaNormalize falls back PER BOUNDARY (`toDate(r.date_start) ?? requested`,
 *     and the same for date_stop), so one row can carry Meta's `date_start` at
 *     UTC midnight beside a `windowEnd` that is the SYNC INSTANT;
 *   • the Google writer passes the sync instant for BOTH boundaries, while
 *     Meta's own dates are always midnight.
 *
 * Under rounding, that difference decides eligibility. A window starting at
 * midnight and ending at the sync instant measured 30 inclusive days before
 * 12:00 UTC and 31 after it — the same row, structurally valid in the morning
 * and PROVENANCE_MISMATCH in the afternoon (proven at 12:01Z on this trunk).
 *
 * Day indices remove the arithmetic that had a threshold in it. Two instants on
 * the same UTC day are the same day, whatever hour they carry, so a canonical
 * period spans the same number of days at 00:01 and at 23:59 — and Meta's
 * midnight and Google's instant describe the same measurement, as they always
 * did in fact.
 *
 * This is a READER-side interpretation. No stored row changes; nothing is
 * rewritten to make a test pass. Both writers keep emitting exactly what their
 * platform reported.
 */
export function inclusiveCanonicalDays(start, end) {
  const [s, e] = [ms(start), ms(end)];
  if (s == null || e == null) return null;
  return utcDayIndex(e) - utcDayIndex(s) + 1;
}

/**
 * How many whole UTC days ago a measurement PERIOD ENDED.
 *
 * Measured from `windowEnd` — the last day the metrics describe — and never from
 * `date`, `createdAt` or the last successful sync. Those say when we LEARNED
 * something; this says how old the thing we learned is, and the two come apart
 * exactly where it matters: re-syncing a January period today writes a row with
 * today's `date` and January's `windowEnd`, and only one of those numbers is
 * evidence about the campaign.
 *
 * UTC calendar days, reusing the same day-index arithmetic canonicalEligibility
 * uses (B5-01E), so a provider's timestamp precision cannot move the answer:
 * 2026-08-23T00:00:00Z and 2026-08-23T18:43:12Z are the same measurement day.
 *
 * @returns {number|null} whole days, 0 when the period ended today. Negative for
 *   a period ending in the future — reported as-is rather than clamped, because
 *   FUTURE_PERIOD is canonicalEligibility's call to make, not this function's.
 *   null when no end is known, which is "we cannot say how old this is" and must
 *   never be read as fresh.
 */
export function measurementAgeDays(windowEnd, now = new Date()) {
  const [e, n] = [ms(windowEnd), ms(now)];
  if (e == null || n == null) return null;
  return utcDayIndex(n) - utcDayIndex(e);
}

/**
 * THE FRESHNESS CONTRACT, in days. Product ruling, 2026-08-26.
 *
 * How old a structurally valid canonical measurement may be and still support a
 * NEW verdict. INCLUSIVE: an age of exactly 3 is current; 4 is not.
 *
 * ── WHY THIS IS NOT DERIVED FROM ANYTHING ELSE ──────────────────────────────
 * Nothing already in the repository could supply this number, and B5-02 checked
 * each candidate rather than assuming: the nine bounds in config/temporal.js are
 * SYNC-RECENCY (how recently we wrote a row); CONNECTOR_STALE_HOURS is about the
 * connector, not the evidence; and CANONICAL_VERDICT_WINDOW_DAYS is the window's
 * LENGTH, not its shelf life. Reverse-engineering any of them into a freshness
 * rule would have been a product decision smuggled into an implementation.
 *
 * Frozen rather than env-tunable, and deliberately: it sits beside
 * CANONICAL_VERDICT_WINDOW_DAYS, which is also not configurable for the same
 * reason — an operator who can move it can change what a verdict MEANS without
 * anyone deciding to. config/temporal.js states the same boundary from the other
 * side: nothing in it is a measurement bound, and this is one.
 *
 * DEFINING AGE IS NOT ENFORCING IT. Nothing in this module gates on this value —
 * canonicalEligibility must stay a STRUCTURAL predicate, so that the same row
 * cannot be structurally valid yesterday and invalid today. Enforcement lives at
 * the verdict evidence partition, which is where `now` already belongs.
 */
export const MAX_CANONICAL_EVIDENCE_AGE_DAYS = 3;

/**
 * Is this row a valid canonical-window measurement?
 *
 * BOTH halves must hold, and neither substitutes for the other:
 *   • the row DECLARES CUMULATIVE_30D — dates that happen to span 30 days are
 *     not enough, because a rolling row can land on any span by coincidence;
 *   • the dates CORROBORATE the declaration — a declaration alone is not enough,
 *     because a producer bug would otherwise be laundered into a canonical row.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canonicalEligibility(row, { now = new Date() } = {}) {
  if (!row || row.measurementWindow !== MEASUREMENT_WINDOW.CUMULATIVE_30D) {
    return { ok: false, reason: REJECTION.NOT_CANONICAL };
  }
  const [start, end] = [ms(row.windowStart), ms(row.windowEnd)];
  if (start == null || end == null) return { ok: false, reason: REJECTION.MISSING_PERIOD };
  if (start > end) return { ok: false, reason: REJECTION.MALFORMED_PERIOD };

  const nowMs = ms(now);
  // A period that has not finished cannot be a completed 30-day measurement.
  // Not clamped to `now` — clamping would silently turn a producer bug into a
  // shorter window that then fails the span check for the wrong reason.
  //
  // Compared by UTC DAY, for the same reason the span is (B5 F-15): the Google
  // writer stamps windowEnd with the sync instant and Meta stamps UTC midnight,
  // so an instant-level comparison rejected one provider's row and accepted the
  // other's for the identical measurement whenever `now` was day-aligned — a
  // provider's timestamp precision deciding structural validity. A window ending
  // on a LATER DAY than now is still refused, which is the thing this guards.
  if (nowMs != null && utcDayIndex(end) > utcDayIndex(nowMs)) {
    return { ok: false, reason: REJECTION.FUTURE_PERIOD };
  }

  // The declaration and the dates must agree, counted in whole UTC days so the
  // answer cannot depend on the hour the row was written or the hour it is read.
  // A window that is off by a whole day is still a different window.
  if (inclusiveCanonicalDays(start, end) !== CANONICAL_VERDICT_WINDOW_DAYS) {
    return { ok: false, reason: REJECTION.PROVENANCE_MISMATCH };
  }
  return { ok: true };
}

/**
 * Resolve ONE stream — rows already narrowed to a single (entityId, source) —
 * to its canonical snapshot.
 *
 * Ordering is by `windowEnd` DESC: the most recently MEASURED canonical period
 * wins, not the most recently synced row. `date` (sync time) breaks an exact tie
 * and does nothing else, which is the whole point — it is a fact about us, not
 * about the campaign.
 *
 * Returns ONE row. Overlapping canonical periods are never summed: three
 * 30-day windows a day apart share 29 days of delivery, so adding them counts
 * that delivery three times (the defect PR #359 removed one layer down).
 *
 * @returns {{ status: string, snapshot: object|null, rejected: Array<{row, reason}> }}
 */
export function resolveCanonicalSnapshot(rows = [], { now = new Date() } = {}) {
  const eligible = [];
  const rejected = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const verdict = canonicalEligibility(row, { now });
    if (verdict.ok) eligible.push(row);
    else rejected.push({ row, reason: verdict.reason });
  }

  if (eligible.length === 0) {
    // NO FALLBACK. The rejected rows are reported so a caller can explain the
    // absence — they are never promoted into the answer.
    return { status: RESOLUTION.NO_CANONICAL_WINDOW, snapshot: null, rejected };
  }

  eligible.sort((a, b) => (ms(b.windowEnd) - ms(a.windowEnd)) || ((ms(b.date) ?? 0) - (ms(a.date) ?? 0)));
  return { status: RESOLUTION.OK, snapshot: eligible[0], rejected };
}

/**
 * Resolve a flat list of rows spanning many entities and sources.
 *
 * Keyed on `entityId|source` — the SAME stream identity latestPerStream uses in
 * BlendedTruthService. A META row and a GA4 row on one campaign are independent
 * measurements of different things; merging them here would let an actual
 * revenue figure satisfy a platform resolution, which is how a cross-window
 * ROAS gets built (see sameWindow above).
 *
 * @returns {Map<string, {status, snapshot, rejected}>} keyed `entityId|source`
 */
export function resolveCanonicalByStream(rows = [], { now = new Date() } = {}) {
  const byStream = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.entityId == null) continue;
    const key = `${row.entityId}|${row.source}`;
    const arr = byStream.get(key);
    if (arr) arr.push(row); else byStream.set(key, [row]);
  }
  const out = new Map();
  for (const [key, streamRows] of byStream) out.set(key, resolveCanonicalSnapshot(streamRows, { now }));
  return out;
}
