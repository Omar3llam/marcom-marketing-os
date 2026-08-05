// ============================================================
// Diagnosis Engine — stable platform vocabulary
// ============================================================
// These enums are the long-term taxonomy for MARCOM's signal
// classification layer.  Do not add dynamic labels — all
// diagnosis names must appear here first.
// ============================================================

export const SIGNAL_TYPE = Object.freeze({
  LOW_CTR:             'LOW_CTR',
  CREATIVE_FATIGUE:    'CREATIVE_FATIGUE',
  AUDIENCE_MISMATCH:   'AUDIENCE_MISMATCH',
  INEFFICIENT_SCALING: 'INEFFICIENT_SCALING',
  HEALTHY:             'HEALTHY',
  // "None of the rules could be evaluated" — the fields they need were never
  // reported. Distinct from HEALTHY, which is a real all-clear reached by
  // running rules that all declined to fire. Once rules became skippable
  // (rather than the engine throwing away the whole diagnosis on one missing
  // field), collapsing the two would have made a blind engine emit a confident
  // all-clear. Also distinct from ROOT_CAUSE.INSUFFICIENT_DATA, which means the
  // fields WERE reported and the sample is too small to read.
  UNDIAGNOSABLE:       'UNDIAGNOSABLE',
});

export const DIAGNOSIS = Object.freeze({
  LOW_CTR:             'weak_hook',
  CREATIVE_FATIGUE:    'creative_fatigue',
  AUDIENCE_MISMATCH:   'audience_mismatch',
  INEFFICIENT_SCALING: 'inefficient_scaling',
  HEALTHY:             'healthy',
  UNDIAGNOSABLE:       'undiagnosable',
});

/**
 * Which metrics carry evidence for each mechanism.
 *
 * Domain knowledge, so it lives with the taxonomy rather than with whatever
 * projects it: "creative fatigue is evidenced by CTR and frequency" is a fact
 * about the mechanism, true regardless of who is reading.
 *
 * It is what makes a CONTRADICTION distinguishable from an unrelated healthy
 * number. A declined rule leaves passing measurements behind; only the ones on
 * THIS mechanism's own metrics argue against it. An inefficient-scaling rule
 * that declined because CPL is fine says nothing whatsoever about whether the
 * creative is exhausted, and counting it as counter-evidence would let an
 * unrelated healthy number talk the engine out of a true diagnosis.
 *
 * ── THE VALUES ARE OBSERVATION METRIC NAMES, UPPERCASE ──────────────────────
 * They must match the strings signalRules' obs() emits ('CTR', 'FREQUENCY',
 * 'CPC', 'CONV_RATE', 'CPL', 'SPEND') — the same UPPERCASE display vocabulary
 * evidenceProvider's EVIDENCE_METRIC and the client's EVIDENCE_UNITS use, NOT
 * the lowercase signal-INPUT field names ('ctr', 'cpcMinor'). A lowercase entry
 * here matches no observation ever emitted, so every lookup silently returns
 * false and contradictions vanish without a single error. There is a test that
 * pins every value in this map to a metric the rules actually produce.
 */
export const MECHANISM_SUPPORT = Object.freeze({
  [SIGNAL_TYPE.CREATIVE_FATIGUE]:    Object.freeze(['CTR', 'FREQUENCY']),
  [SIGNAL_TYPE.AUDIENCE_MISMATCH]:   Object.freeze(['CPC', 'CONV_RATE']),
  // SPEND is genuinely part of this mechanism, and is listed for that reason —
  // though it has no benchmark, so its observation is never graded and can
  // never itself become a contradiction. Listing it keeps the map a statement
  // about the domain rather than about which comparisons happen to be scored.
  [SIGNAL_TYPE.INEFFICIENT_SCALING]: Object.freeze(['CPL', 'SPEND']),
  [SIGNAL_TYPE.LOW_CTR]:             Object.freeze(['CTR']),
  // Terminal states, not mechanisms: nothing supports or contradicts them.
  [SIGNAL_TYPE.HEALTHY]:             Object.freeze([]),
  [SIGNAL_TYPE.UNDIAGNOSABLE]:       Object.freeze([]),
});
