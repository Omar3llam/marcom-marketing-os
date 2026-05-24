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
});

export const DIAGNOSIS = Object.freeze({
  LOW_CTR:             'weak_hook',
  CREATIVE_FATIGUE:    'creative_fatigue',
  AUDIENCE_MISMATCH:   'audience_mismatch',
  INEFFICIENT_SCALING: 'inefficient_scaling',
  HEALTHY:             'healthy',
});
