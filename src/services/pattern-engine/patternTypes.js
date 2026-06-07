// ============================================================
// Pattern Engine — stable vocabulary
// ============================================================
// The kinds of durable pattern Lumi mines from one workspace's own
// history, and the lifecycle status of each. Mirrors the Prisma
// `PatternKind` / `PatternStatus` enums. No dynamic labels.
// ============================================================

export const PATTERN_KIND = Object.freeze({
  FATIGUE_CEILING:         'FATIGUE_CEILING',         // freq ≥ ceiling → KILL/REFRESH (promotable)
  SCALING_WINDOW:          'SCALING_WINDOW',          // ROAS ≥ X → SCALE held (promotable)
  CREATIVE_ANGLE_LONGEVITY:'CREATIVE_ANGLE_LONGEVITY',// which angles last (informational)
  SEASONAL_EFFECT:         'SEASONAL_EFFECT',         // period shift, e.g. Ramadan (informational)
});

export const PATTERN_STATUS = Object.freeze({
  EMERGING:    'EMERGING',    // seen, but thin support or unproven accuracy
  ESTABLISHED: 'ESTABLISHED', // enough recency-weighted support AND accuracy
  SUPERSEDED:  'SUPERSEDED',  // a better, conflicting pattern won — do not act on this
  CONFLICTED:  'CONFLICTED',  // a genuine tie with an opposite pattern — needs human review
});

// Kinds that carry an executable guardrail spec (can be promoted).
export const PROMOTABLE_KINDS = Object.freeze([
  PATTERN_KIND.FATIGUE_CEILING,
  PATTERN_KIND.SCALING_WINDOW,
]);
