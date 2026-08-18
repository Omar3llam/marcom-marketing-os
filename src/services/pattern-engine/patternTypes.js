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

// The accuracy floor a pattern must clear before it may become a rule, or be
// offered to future decision context. One constant, read by the promotion gate
// (PlaybookService), the briefing surfaces, and the memory layer — three places
// that were drifting apart with a hard-coded 0.6 each.
export const MIN_PATTERN_ACCURACY = Number(process.env.PATTERN_PROMOTE_MIN_ACCURACY || 0.6);

/**
 * PURE: is this PERSISTED AccountPattern row provably ready to act on?
 *
 * The same question three surfaces were each answering with their own copy of
 * the predicate (PlaybookService's throw-list, the Lumi feed's inline filter,
 * the engine's in-memory `promotable` flag). Copies of a governance rule drift,
 * and the drift shows up as a pattern the briefing offers to promote and the
 * promote endpoint then refuses.
 *
 * Every clause is a refusal to overstate:
 *   ESTABLISHED    — EMERGING means unproven, and R10 (I54) means it may also
 *                    mean entirely unmeasured.
 *   accuracy       — measured, and above the floor. Never null: a pattern with
 *                    no outcome behind it has no track record to act on.
 *   executable spec— an informational pattern has no rule to become.
 *   not promoted   — already a rule; promoting twice would duplicate it.
 */
export function isActionablePattern(p) {
  if (!p) return false;
  return p.status === PATTERN_STATUS.ESTABLISHED
    && p.accuracy != null && p.accuracy >= MIN_PATTERN_ACCURACY
    && !!p.emitVerdict && p.threshold != null
    && !p.promotedRuleId;
}
