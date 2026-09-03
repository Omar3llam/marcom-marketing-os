// ============================================================
// PlaybookService — promote a learned pattern into a GuardrailRule
// ============================================================
// One-tap "make it a rule". Reuses the entire Phase-2 governance loop:
// the created GuardrailRule is auto-evaluated by GuardrailSweepService →
// PROPOSED Decision → confirm→execute → OutcomeSnapshot → memory. No new
// evaluation/execution code.
//
// HONESTY GUARD: only an ESTABLISHED, accurate, non-conflicted pattern
// with a valid spec can be promoted — Lumi never ships an unproven or
// contradictory rule.
// ============================================================
// C-05 — this module is now PURE. It shapes and it refuses; it does not write.
// The DB half moved to PromotionService along with the authorization it needs.
import { PATTERN_STATUS } from './patternTypes.js';

// Exported (C-05) because it is a property of the MOMENT, not of the code: it
// is env-driven and read once at module load, so a promotion authorized under
// 0.75 and one authorized under 0.6 are different claims. The authorization
// record stores the floor that was applied rather than reading this later.
export const PROMOTE_MIN_ACCURACY = Number(process.env.PATTERN_PROMOTE_MIN_ACCURACY || 0.6);
const MIN_ACCURACY = PROMOTE_MIN_ACCURACY;
const VALID_COMPARATORS = new Set(['GT', 'GTE', 'LT', 'LTE']);
const VALID_UNITS       = new Set(['MINOR', 'RATIO', 'PCT']);

/**
 * Pure: validate a pattern is promotable and shape it into GuardrailRule
 * create-data. Throws (does NOT silently skip) on any non-promotable
 * pattern. Exported for unit testing without a DB.
 *
 * @param {object} p — AccountPattern row (or engine pattern)
 * @param {string} workspaceId
 * @returns {object} prisma.guardrailRule create data
 */
export function patternToGuardrailData(p, workspaceId) {
  if (!workspaceId) throw new Error('patternToGuardrailData: workspaceId required');
  if (!p) throw new Error('patternToGuardrailData: pattern required');
  if (p.status === PATTERN_STATUS.SUPERSEDED || p.status === PATTERN_STATUS.CONFLICTED) {
    throw new Error(`Pattern is ${p.status} — a reconciled/contested pattern cannot become a rule.`);
  }
  if (p.status !== PATTERN_STATUS.ESTABLISHED) {
    throw new Error('Pattern is not ESTABLISHED yet — needs more proven history before it can become a rule.');
  }
  if (p.accuracy == null || p.accuracy < MIN_ACCURACY) {
    throw new Error(`Pattern accuracy ${p.accuracy ?? 'unknown'} is below the ${MIN_ACCURACY} floor to promote.`);
  }
  if (!p.emitVerdict || !p.metric || p.threshold == null ||
      !VALID_COMPARATORS.has(p.comparator) || !VALID_UNITS.has(p.unit)) {
    throw new Error('Pattern has no valid executable spec — it is informational only.');
  }
  if (p.promotedRuleId) throw new Error('Pattern has already been promoted to a rule.');

  return {
    workspaceId,
    name:          `Learned: ${String(p.statement).slice(0, 80)}`,
    enabled:       true,
    // C-05 · which learning produced this rule. IDENTITY, not belief: the
    // pattern row is upserted in place, so this answers "where did it come
    // from" and never "what did it claim at the time". The frozen claim is in
    // the AUTONOMY_GRANTED event. NULL on a hand-authored rule.
    sourcePatternId: p.id ?? null,
    scopeLevel:    p.scopeLevel ?? 'ADSET',
    audienceTag:   p.audienceTag ?? null,
    metric:        p.metric,
    comparator:    p.comparator,
    threshold:     p.threshold,
    unit:          p.unit,
    sustainedDays: p.sustainedDays ?? 1,
    emitVerdict:   p.emitVerdict,
  };
}

// ── C-05 · `promotePattern` USED TO LIVE HERE ───────────────────────────────
//
// It took a workspace and a pattern id, created the rule, linked it, and wrote
// a `logger.info`. One call: propose and grant, by one person, leaving no row
// behind that named them.
//
// R-13 ruled that granting Lumi durable authority over later judgments requires
// an explicit authorization, so the function is gone rather than wrapped — a
// surviving one-call path would be an ungated route to the same grant, which is
// the defect and not a compatibility courtesy.
//
// The shaping and the governance gate above are unchanged and are now called by
// PromotionService, which owns the authorization, the frozen record of what was
// believed at the time, and the way back (R-14).
