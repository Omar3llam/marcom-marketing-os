// ============================================================
// Recommendation Engine — stable platform vocabulary
// ============================================================
// These enums define the complete vocabulary of actionable
// recommendations MARCOM can produce.  No dynamic labels.
// ============================================================

export const REC_TYPE = Object.freeze({
  REFRESH_HOOK:      'REFRESH_HOOK',
  ROTATE_CREATIVE:   'ROTATE_CREATIVE',
  TEST_NEW_ANGLE:    'TEST_NEW_ANGLE',
  REDUCE_BUDGET:     'REDUCE_BUDGET',
  DUPLICATE_WINNER:  'DUPLICATE_WINNER',
  HOLD_STEADY:       'HOLD_STEADY',
  // Phase 2 — first-class verdict execution paths
  REALLOCATE_BUDGET: 'REALLOCATE_BUDGET',
  REFRESH_CREATIVE:  'REFRESH_CREATIVE',
});

export const PRIORITY = Object.freeze({
  HIGH:   'HIGH',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW',
});
