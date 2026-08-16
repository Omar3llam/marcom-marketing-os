// ============================================================
// observationComparability — I20, as a contract rather than a comment
// ============================================================
// PURE. No DB, no clock, no workspace context, no env. It takes two observations
// a reader already holds and answers one question:
//
//     may these two rows legally be compared?
//
// I20 (R7): two measurements may only be compared when the rows themselves prove
// they are comparable. Comparability is never inferred from the order rows were
// written, the order an array happens to be in, the preset that requested them,
// or the time elapsed between syncs. It is read from the periods the PLATFORM
// declared, and from nothing else.
//
// WHY THIS EXISTS AT ALL
// ----------------------
// R7 found eight uncaught failure modes in the substrate, and every one of them
// was the same absence wearing a different face: R1–R6 govern how a SINGLE read
// describes itself, and nothing governed the relationship between TWO. A
// before/after measurement is nothing but that relationship, and the arithmetic
// that violates it — `snapshot(T+1) − snapshot(T)` — is the most natural thing a
// future implementer would write.
//
// WHAT IT IS NOT
// --------------
// Comparable is not "improved", "worked", or "correct". This module returns a
// structural verdict about two rows; it says nothing about what happened, what
// caused it, or whether anyone should be pleased. A caller that reads `ok: true`
// has learned that a difference would be arithmetically meaningful — not that
// the difference means anything about a decision.
//
// THE DAILY CASE IS THE EASY ONE, AND DELIBERATELY SO
// ---------------------------------------------------
// R7's rolling-window analysis needed a gate (nested windows, shared starts,
// entity lifetimes) because trailing aggregates overlap by construction. Two
// true daily observations either cover the same day or they do not. That is why
// Phase E came first: this contract is short because the substrate underneath it
// is honest, not because the rules were relaxed.
// ============================================================
import {
  ADDITIVE_METRICS, CUMULATIVE_METRICS, METRIC_FAMILY, metricFamily, inclusiveDays,
} from '../verdict-engine/metricWindow.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

const DAY_MS = 86_400_000;

/**
 * Why two observations may not be compared. Named values, not booleans: a caller
 * that can only say "no" tells an operator nothing, and each of these has a
 * different fix (or is deliberately unfixable). Mirrors metricWindow.REJECTION,
 * which does the same job for a single canonical row.
 */
export const COMPARABILITY = Object.freeze({
  MISSING_OBSERVATION:   'MISSING_OBSERVATION',   // one side has nothing to compare
  AMBIGUOUS_OBSERVATION: 'AMBIGUOUS_OBSERVATION', // the day did not reduce to one reading
  UNIDENTIFIED_ROW:      'UNIDENTIFIED_ROW',      // cannot name the row it consumed
  DIFFERENT_WORKSPACE:   'DIFFERENT_WORKSPACE',
  DIFFERENT_ENTITY:      'DIFFERENT_ENTITY',
  DIFFERENT_LEVEL:       'DIFFERENT_LEVEL',
  DIFFERENT_SOURCE:      'DIFFERENT_SOURCE',
  DIFFERENT_POPULATION:  'DIFFERENT_POPULATION',  // not both DAILY
  MALFORMED_PERIOD:      'MALFORMED_PERIOD',      // missing, inverted, or not one day
  OVERLAPPING_PERIODS:   'OVERLAPPING_PERIODS',   // they share delivery
  WRONG_ORDER:           'WRONG_ORDER',           // "after" precedes "before"
});

/**
 * PURE: the half-open instant range a daily observation covers.
 *
 * The repository states periods INCLUSIVE at both ends (canonicalWindowBounds:
 * "a 1-day window is [now, now]"), and Phase E writes windowStart === windowEnd
 * at UTC midnight. So one day's real extent is [start, start + 1 day) — the
 * closing instant is derived here, once, rather than at three call sites that
 * would eventually disagree about whether a day ends at midnight or a
 * millisecond before it.
 *
 * Returns null when the row cannot state exactly one day. Deliberately strict:
 * a period this module cannot read is refused, never guessed at, and never
 * clamped into shape. `inclusiveDays` is metricWindow's, not a second copy.
 *
 * @returns {{ start:number, end:number }|null}
 */
export function dailyPeriod(observation) {
  const start = ms(observation?.windowStart);
  const end = ms(observation?.windowEnd);
  if (start == null || end == null) return null;
  if (start > end) return null;
  // Exactly one day, by the repository's own inclusive-day arithmetic. A row
  // spanning two days is a trailing aggregate that reached the wrong reader, and
  // a row spanning zero is malformed; neither may be silently treated as a day.
  if (inclusiveDays(observation.windowStart, observation.windowEnd) !== 1) return null;
  return { start, end: start + DAY_MS };
}

/**
 * Do these two periods share any delivery at all?
 * Half-open on both sides, so two adjacent days do NOT overlap: [Aug 9, Aug 10)
 * and [Aug 10, Aug 11) touch and share nothing, which is exactly the pair a
 * before/after comparison wants.
 */
export function periodsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * THE I20 CONTRACT. May `before` and `after` be compared?
 *
 * Twelve conditions, checked in the order that makes a failure most useful: the
 * ones about whether an observation exists at all come before the ones about
 * what it says, so a caller is never told "different source" about a row that is
 * missing.
 *
 * @param {object|null} before — a reduced daily observation, or null
 * @param {object|null} after  — a reduced daily observation, or null
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function areComparable(before, after) {
  // 9. neither side is missing
  if (!before || !after) return no(COMPARABILITY.MISSING_OBSERVATION);
  // 10. neither observation is ambiguous — a day that did not reduce to one
  //     reading is not a measurement, and picking one of its rows would make the
  //     result depend on which row a query happened to return first.
  if (before.ambiguous || after.ambiguous) return no(COMPARABILITY.AMBIGUOUS_OBSERVATION);
  // 12. the exact rows consumed can be identified. Without this the answer is
  //     unreproducible: a later reader could not fetch the same two rows back.
  if (!before.id || !after.id) return no(COMPARABILITY.UNIDENTIFIED_ROW);

  // 1–4. same measured thing. Any of these differing means the difference would
  //      describe two subjects rather than one subject over time.
  if (before.workspaceId !== after.workspaceId) return no(COMPARABILITY.DIFFERENT_WORKSPACE);
  if (before.entityId !== after.entityId) return no(COMPARABILITY.DIFFERENT_ENTITY);
  if (before.entityLevel !== after.entityLevel) return no(COMPARABILITY.DIFFERENT_LEVEL);
  if (before.source !== after.source) return no(COMPARABILITY.DIFFERENT_SOURCE);

  // 5. same measurement window, and specifically the DAILY one. Two populations
  //    that both happen to be "not canonical" are still two populations.
  if (before.measurementWindow !== after.measurementWindow) return no(COMPARABILITY.DIFFERENT_POPULATION);
  if (before.measurementWindow !== MEASUREMENT_WINDOW.DAILY) return no(COMPARABILITY.DIFFERENT_POPULATION);

  // 11. neither observation is malformed — read from the declared period, which
  //     is the only thing that can prove a row is a day.
  const b = dailyPeriod(before);
  const a = dailyPeriod(after);
  if (!b || !a) return no(COMPARABILITY.MALFORMED_PERIOD);

  // 7. the periods do not overlap. Identical days land here too, and correctly:
  //    a day compared with itself is not a before/after pair.
  if (periodsOverlap(b, a)) return no(COMPARABILITY.OVERLAPPING_PERIODS);
  // 8. …and they are in the order the caller claimed. Established from the
  //    periods, never from which row was synced first — the whole point of I20.
  if (b.end > a.start) return no(COMPARABILITY.WRONG_ORDER);

  // 6. metric families are a property of the population, not of the pair: both
  //    sides are DAILY, so the same family rules apply to both, and which
  //    metrics may be differenced is answered by additiveDifference below rather
  //    than by a boolean here.
  return { ok: true };
}

/**
 * The metrics a daily difference may legally be taken over — the ADDITIVE family
 * and nothing else, straight from metricWindow.
 *
 * Frozen and exported so a caller can ASK rather than assume, and so the list
 * cannot be extended at a call site.
 */
export const DIFFERENCEABLE_METRICS = Object.freeze([...ADDITIVE_METRICS]);

/**
 * PURE: the per-metric difference between two comparable daily observations.
 *
 * ADDITIVE ONLY, and the refusals matter more than the arithmetic:
 *
 *   • reach and frequency are CUMULATIVE — they count unique people, so the
 *     difference of two days' values is not a quantity that exists.
 *     Phase E already lands them null; this refuses them even if a future
 *     producer does not.
 *   • ctr and roas are DERIVED — ratios, which are recomputed from summed parts
 *     rather than subtracted. Each side's own ratio is available on the
 *     observation; a "ctr delta" is not offered because it is not a measurement,
 *     and a caller that wants one is asking a question this module will not
 *     answer for it.
 *
 * NOT AN OUTCOME. This is `after − before` over five counters. It says nothing
 * about intervention, causation, success, or a decision. The naming is
 * deliberately arithmetic.
 *
 * @returns {{ok:true, metrics:object}|{ok:false, reason:string}}
 */
export function additiveDifference(before, after) {
  const verdict = areComparable(before, after);
  if (!verdict.ok) return verdict;

  const metrics = {};
  for (const key of DIFFERENCEABLE_METRICS) {
    const b = before[key];
    const a = after[key];
    // A metric absent on either side is not zero on that side. Absence
    // propagates as null — the difference of an unmeasured quantity is
    // unmeasured, and substituting 0 would invent the very number this whole
    // track exists to refuse.
    metrics[key] = (isNum(b) && isNum(a)) ? a - b : null;
  }
  return { ok: true, metrics };
}

/**
 * PURE: may this metric take part in a daily difference?
 * Answers from metricWindow's families, so the two can never drift.
 */
export function isDifferenceable(metric) {
  return metricFamily(metric) === METRIC_FAMILY.ADDITIVE;
}

/** The metrics that must NEVER be differenced across days, for a caller's checks. */
export const NON_DIFFERENCEABLE_METRICS = Object.freeze([...CUMULATIVE_METRICS]);

// ── small pure helpers ────────────────────────────────────────────
const no = (reason) => ({ ok: false, reason });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ms = (d) => {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
};
