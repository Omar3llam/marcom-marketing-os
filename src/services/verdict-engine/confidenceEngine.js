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
// ============================================================

// Below this, a rate computed off the sample is noise — the domain model's
// "< 1000 impressions = no verdict possible". Exported because the min-sample
// gate in the verdict engine enforces the same number and the two must not drift.
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

const PENALTY = Object.freeze({
  NO_LPV:         0.15, // funnel blind — cannot tell a creative problem from a landing-page one
  NO_ATC:         0.10, // mid-funnel blind
  NO_CREATED_TIME: 0.10, // cannot assess the learning window
  NO_OBJECTIVE:   0.10, // benchmarks fall back to DEFAULT — judged against the wrong bar
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
 */
export function dataCompleteness({ actionMetrics = null, objective = null, createdTime = null } = {}) {
  let score = 1.0;
  if (!actionMetrics?.lpv) score -= PENALTY.NO_LPV;
  if (!actionMetrics?.atc) score -= PENALTY.NO_ATC;
  if (!createdTime)        score -= PENALTY.NO_CREATED_TIME;
  if (!objective)          score -= PENALTY.NO_OBJECTIVE;
  return Math.max(score, COMPLETENESS_FLOOR);
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
 * @returns {number} 0–MAX_CONFIDENCE, 2dp
 */
export function computeConfidence({
  impressions = 0,
  daysRunning = null,
  actionMetrics = null,
  objective = null,
  createdTime = null,
} = {}) {
  const raw = sampleQuality(impressions)
    * dataCompleteness({ actionMetrics, objective, createdTime })
    * temporalQuality(daysRunning);
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
