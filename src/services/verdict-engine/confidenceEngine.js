// ============================================================
// confidenceEngine — confidence as a FUNCTION, never a constant
// ============================================================
// Public API: computeConfidence({ impressions, daysRunning, actionMetrics,
//                                 objective, createdTime })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no randomness. Deliberately does
//   NOT read the clock: daysRunning is passed in, so a stored verdict's
//   confidence is reproducible from its inputs forever.
//
// WHY THIS EXISTS:
//   Every confidence the engine emitted was a frozen literal — 0.9 for a KILL,
//   0.85 for fatigue, 0.7 for a hold. A KILL on 400 impressions and a KILL on
//   400,000 both reported 0.9. Layer 7 of the domain model says the opposite:
//   confidence rises with spend, events and days. A number that does not move
//   with its evidence is decoration, and worse than none — the calibration layer
//   (decisionAccuracyEngine) consumes these as if they meant something.
//
// THREE DIMENSIONS, MULTIPLIED:
//   sample      — is there enough traffic to read a rate off at all
//   completeness— do we have the fields the diagnosis actually needs
//   temporal    — has it run long enough to have settled
//   They multiply because they are not substitutes: perfect data on 50
//   impressions is still 50 impressions, and a week of blind data is still blind.
//
// NEVER 1.0:
//   Capped at 0.97. Platform-reported numbers carry attribution error we cannot
//   see from here, so certainty is never honest.
//
// ── C-09: THE DIMENSIONS ARE PUBLISHED, THE ARITHMETIC IS UNCHANGED ─────────
// All three were exported, documented and tested here, and had ZERO callers
// outside this module: `computeConfidence` multiplied them and returned the
// product, so a payload could say "low" and never which of the three was low.
// `computeConfidenceDimensions` returns them WITH the basis each needs to be
// explainable, and `computeConfidence` is now folded from that one computation
// rather than performing a second one.
// ============================================================
import { COMPLETENESS_FIELD } from '@marcom/runtime-contracts';

// Below this, a rate computed off the sample is noise — the domain model's
// "< 1000 impressions = no verdict possible". Exported because the min-sample
// gate in the verdict engine enforces the same number and the two must not drift.
//
// WINDOW (canonical contract, see metricWindow.js): 1,000 impressions
// ACCUMULATED OVER THE CANONICAL VERDICT WINDOW — 30 days — not per day and not
// over whatever period the last sync requested. The distinction is load-bearing
// at this threshold more than any other: a campaign delivering 500 impressions
// a day clears the bar comfortably in 30 days and would fail it every single day
// if the gate were ever applied to daily rows, pinning it in permanent
// INSUFFICIENT_DATA. CALIBRATION: UNKNOWN — cited to a domain model that has no
// file in this repository.
export const MIN_IMPRESSIONS = 1000;

// The point at which more traffic stops meaningfully improving confidence in a
// rate. Not a promise of significance — a saturation point for this heuristic.
export const GOOD_IMPRESSIONS = 10_000;

// Verdicts are never certain: platform attribution error is invisible from here.
export const MAX_CONFIDENCE = 0.97;

// Completeness floor. Even blind on every optional field, spend/impressions/
// clicks are real and measured, so confidence must not collapse to ~0 and imply
// we know nothing at all.
const COMPLETENESS_FLOOR = 0.4;

// C-09 — keyed by the FIELD IDENTITY, so the score and the list of what is
// missing come from one structure. Two structures would drift, and the first
// place they would drift is `createdTimeApplicable`, where the penalty is
// deliberately not charged.
const PENALTY = Object.freeze({
  [COMPLETENESS_FIELD.LPV]:          0.15, // funnel blind — cannot tell a creative problem from a landing-page one
  [COMPLETENESS_FIELD.ATC]:          0.10, // mid-funnel blind
  [COMPLETENESS_FIELD.CREATED_TIME]: 0.10, // cannot assess the learning window
  [COMPLETENESS_FIELD.OBJECTIVE]:    0.10, // benchmarks fall back to DEFAULT — judged against the wrong bar
});

/** PURE: clamp into [0, 1]. */
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * PURE: how much traffic is behind the rates, 0–1.
 * Linear to GOOD_IMPRESSIONS then flat. Zero impressions is zero confidence —
 * there is nothing to be confident about.
 */
export function sampleQuality(impressions = 0) {
  if (!Number.isFinite(impressions) || impressions <= 0) return 0;
  return clamp01(impressions / GOOD_IMPRESSIONS);
}

/**
 * PURE: how much of the diagnostic input we actually have, COMPLETENESS_FLOOR–1.
 * Each missing field is a specific thing the diagnosis cannot see, not a generic
 * penalty — the comments in PENALTY name what each one costs.
 *
 * NOT APPLICABLE ≠ MISSING. `createdTimeApplicable: false` says the entity being
 * scored has no creative age to report — an AD SET is not a creative, so there
 * is no platform creation time it failed to give us. Charging NO_CREATED_TIME
 * there would mark a level down for the shape of the entity graph rather than
 * for anything about the data, and would do it invisibly: the score would simply
 * read lower on a scale the caller believes it shares with ad-level analyses.
 * The genuine uncertainty about the learning window is still charged, once, by
 * temporalQuality's 0.7 for an unknown age.
 *
 * Defaults to true, so every existing caller is unaffected: a missing
 * createdTime on a level that HAS one is still a real gap in our ingestion.
 */
export function dataCompleteness(args = {}) {
  return completenessAssessment(args).score;
}

/**
 * PURE: the completeness score AND the identities behind it, from ONE pass.
 *
 * C-09 — the list is not derived from the number and the number is not derived
 * from the list; both fall out of the same walk over the four fields, in the
 * same order the score was always accumulated in. A separately-built list could
 * disagree with the score, and `createdTimeApplicable` is exactly where it
 * would: the penalty is not charged there, so the field must not be NAMED there
 * either, or the two halves of one claim would contradict each other on the wire.
 */
function completenessAssessment({
  actionMetrics = null,
  objective = null,
  createdTime = null,
  createdTimeApplicable = true,
} = {}) {
  const missing = [];
  if (!actionMetrics?.lpv) missing.push(COMPLETENESS_FIELD.LPV);
  if (!actionMetrics?.atc) missing.push(COMPLETENESS_FIELD.ATC);
  if (createdTimeApplicable && !createdTime) missing.push(COMPLETENESS_FIELD.CREATED_TIME);
  if (!objective)          missing.push(COMPLETENESS_FIELD.OBJECTIVE);

  let score = 1.0;
  for (const field of missing) score -= PENALTY[field];
  return { score: Math.max(score, COMPLETENESS_FLOOR), missing };
}

/**
 * PURE: has it run long enough to have settled, 0–1.
 *
 * null (unknown age) scores 0.7, NOT 0: an unknown creation date is a gap in our
 * ingestion, not evidence the campaign is new. Penalising it to zero would make
 * every pre-connector row unscoreable; treating it as mature would hide genuinely
 * day-1 campaigns. 0.7 says "probably fine, but we cannot confirm" — and the
 * missing createdTime is separately charged in dataCompleteness, so the gap is
 * counted once as uncertainty and once as incompleteness, never ignored.
 *
 * That double-charge is correct when the age is MISSING. It is not when the
 * level has no creative age to miss — see dataCompleteness's
 * createdTimeApplicable, which drops the incompleteness half in that case and
 * leaves this 0.7 as the single, honest charge.
 */
export function temporalQuality(daysRunning = null) {
  if (daysRunning == null || !Number.isFinite(daysRunning)) return 0.7;
  if (daysRunning < 3) return 0.4;
  if (daysRunning < 7) return 0.7;
  return 1.0;
}

/**
 * Confidence in a verdict's INPUTS: sample × completeness × temporal.
 *
 * This is the data-quality half of confidence. It says nothing about how strong
 * the signal is — a clear fatigue pattern and a shrug both score the same here.
 * The verdict engine multiplies this by the signal's own strength, so the final
 * number moves with BOTH. See composeConfidence.
 *
 * @param {object} args
 * @param {number} [args.impressions=0]
 * @param {number|null} [args.daysRunning=null] — days since platform creation
 * @param {object|null} [args.actionMetrics=null] — the funnel bag
 * @param {string|null} [args.objective=null]
 * @param {Date|string|null} [args.createdTime=null]
 * @param {boolean} [args.createdTimeApplicable=true] — false when the entity
 *   being scored has no creative age at all (see dataCompleteness). Affects only
 *   completeness; the temporal half still scores the unknown window honestly.
 * @returns {number} 0–MAX_CONFIDENCE, 2dp
 */
export function computeConfidence(args = {}) {
  const dimensions = computeConfidenceDimensions(args);
  // An unknown sample yields no dimensions (see below). The result is unchanged
  // from before C-09: sampleQuality() returns 0 for a non-finite input, so the
  // product was — and still is — exactly 0. No caller's number moves.
  return dimensions ? foldConfidenceDimensions(dimensions) : 0;
}

/**
 * The three dimensions behind `dataConfidence`, each WITH the basis that makes
 * it explainable (C-09).
 *
 * ── WHY null RATHER THAN sampleQuality: 0 ───────────────────────────────────
 * `sampleQuality(undefined)` is 0, and 0 is a real answer meaning "we measured
 * this campaign and it delivered nothing". Publishing that for a caller who
 * never told us the sample size would state a measurement we never made — the
 * exact class of defect C-03, C-04 and C-07 each removed one layer down.
 *
 * So the whole object is absent when the sample is unknown, which mirrors
 * `dataConfidence` (already null in precisely this case) and makes the rule
 * structural rather than a convention:
 *
 *     dataConfidenceDimensions !== null  ⟺  dataConfidence !== null
 *
 * ── WHY EACH DIMENSION CARRIES ITS BASIS ────────────────────────────────────
 * `temporalQuality` returns 0.70 for an UNKNOWN age and 0.70 for a five-day-old
 * campaign: one number answering two different questions. Only `daysRunning`
 * separates them, and neither it nor `impressions` reached any consumer before
 * C-09 — so a published dimension could be neither explained nor checked.
 *
 * @returns {{sampleQuality:number, impressions:number, dataCompleteness:number,
 *   dataCompletenessMissingFields:readonly string[], temporalQuality:number,
 *   daysRunning:number|null}|null}
 */
export function computeConfidenceDimensions({
  // NO DEFAULT, deliberately — `= 0` would turn "you never told us" into "we
  // measured zero", which is the very substitution this function exists to
  // refuse. computeConfidence keeps its own 0 for that case, so no number moves.
  impressions,
  daysRunning = null,
  actionMetrics = null,
  objective = null,
  createdTime = null,
  createdTimeApplicable = true,
} = {}) {
  if (!Number.isFinite(impressions)) return null;

  const completeness = completenessAssessment({
    actionMetrics, objective, createdTime, createdTimeApplicable,
  });

  return Object.freeze({
    sampleQuality: sampleQuality(impressions),
    impressions,
    dataCompleteness: completeness.score,
    dataCompletenessMissingFields: Object.freeze(completeness.missing),
    temporalQuality: temporalQuality(daysRunning),
    // The honest "we could not establish this", NOT the 0.70 default above.
    daysRunning: Number.isFinite(daysRunning) ? daysRunning : null,
  });
}

/**
 * PURE: fold the three dimensions back into `dataConfidence`.
 *
 * THE ENGINE OWNS THIS. It exists so the composition has exactly one
 * implementation that both the scalar and the decomposition come from — never
 * so a consumer can call it. A surface that multiplies published numbers can
 * land on a different figure (the cap and the rounding both bite) and mistake
 * it for the truth; every intermediate value is published precisely so nobody
 * has to compute one.
 */
export function foldConfidenceDimensions(dimensions) {
  if (!dimensions) return null;
  const raw = dimensions.sampleQuality * dimensions.dataCompleteness * dimensions.temporalQuality;
  return Math.min(Math.round(raw * 100) / 100, MAX_CONFIDENCE);
}

/**
 * PURE: fold signal strength together with input quality into one number.
 *
 * Kept separate from computeConfidence so the data-quality score stays a thing
 * you can read on its own (and test on its own). Multiplication, not min or
 * average: a strong signal read off thin data is not a strong verdict, and
 * neither is a weak signal read off perfect data.
 *
 * @param {number} signalConfidence — the rule's own strength, 0–1
 * @param {number} dataConfidence — computeConfidence()'s result, 0–1
 * @returns {number} 0–MAX_CONFIDENCE, 2dp
 */
export function composeConfidence(signalConfidence, dataConfidence) {
  const s = Number.isFinite(signalConfidence) ? clamp01(signalConfidence) : 0;
  const d = Number.isFinite(dataConfidence) ? clamp01(dataConfidence) : 0;
  return Math.min(Math.round(s * d * 100) / 100, MAX_CONFIDENCE);
}

/**
 * PURE: whole days between a platform creation time and a reference instant.
 *
 * `now` is an explicit parameter, never Date.now() read inside: the verdict
 * engine's determinism contract forbids reading the clock, so the caller (which
 * already owns time) passes it in.
 *
 * @returns {number|null} null when no creation time is known — the honest
 *   "we cannot say how old this is", which the too-early gate must skip rather
 *   than treat as day 0.
 */
export function daysSince(createdTime, now = Date.now()) {
  if (createdTime == null) return null;
  const t = createdTime instanceof Date ? createdTime.getTime() : Date.parse(createdTime);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  return days < 0 ? 0 : days; // a clock-skewed future date is "brand new", not negative
}
