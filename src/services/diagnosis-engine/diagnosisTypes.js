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
