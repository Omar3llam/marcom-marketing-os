// ============================================================
// confidenceDimensions — what a confidence number is made of (C-09)
// ============================================================
// 🔒 C-09, locked:
//
//   Confidence dimensions EXPLAIN a confidence value; they do not redefine it.
//   The engine owns composition, and consumers may display but never recompute
//   it. Missing confidence remains missing and is never interpreted as healthy.
//
// ── WHAT THE ENGINE COMPOSES, AND WHO OWNS EACH STEP ────────────────────────
//
//   sampleQuality × dataCompleteness × temporalQuality  =  dataConfidence
//   signalConfidence × dataConfidence                   =  baseConfidence
//   baseConfidence × institutionalMemory.factor         =  confidence
//
// Every one of those is rounded to 2dp and capped at 0.97, and the last also
// clamps. So the equalities are ENGINE INVARIANTS, not consumer instructions: a
// consumer that multiplies the published numbers can land on a different figure
// — most visibly when the cap bites twice — and believe it is the truth. The
// engine publishes every intermediate value precisely so nobody has to.
//
// ── WHY THIS VOCABULARY IS SHARED ───────────────────────────────────────────
// The C-07 rule, applied again: a vocabulary belongs in this package when THE
// CLIENT MUST BRANCH ON ITS VALUES. It must, here — "landing-page views" and
// "campaign objective" are different sentences, and the difference is what makes
// an incomplete score actionable instead of merely low.
//
// The ARITHMETIC stays in src/services/verdict-engine/confidenceEngine.js: it is
// the verdict engine's determinism contract, not a shared utility.
//
// PURE. No I/O, no clock, no logger.
// ============================================================

/**
 * The diagnostic inputs `dataCompleteness` charges for when they are absent.
 *
 * These are IDENTITIES, not statuses: each names a specific thing the diagnosis
 * could not see. The penalty each one costs, and the reason it costs that, live
 * beside the arithmetic in confidenceEngine.js — one definition, one place.
 *
 * A scalar can quantify an absence; it cannot explain it. `dataCompleteness:
 * 0.75` says how much is missing, and only this list says WHAT.
 */
export const COMPLETENESS_FIELD = Object.freeze({
  /** Landing-page views. Without them a creative problem and a landing-page one look alike. */
  LPV: 'LPV',
  /** Add-to-cart. Mid-funnel blind. */
  ATC: 'ATC',
  /** Platform creation time — the learning window cannot be assessed without it. */
  CREATED_TIME: 'CREATED_TIME',
  /** The platform objective. Without it benchmarks fall back to DEFAULT: the wrong bar. */
  OBJECTIVE: 'OBJECTIVE',
});

/** The field identities, for validation and for tests that must be exhaustive. */
export const COMPLETENESS_FIELD_VALUES = Object.freeze(Object.values(COMPLETENESS_FIELD));

/** Whether a value is a completeness field this build has declared. */
export function isCompletenessField(field) {
  return COMPLETENESS_FIELD_VALUES.includes(field);
}
