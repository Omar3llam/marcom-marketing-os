// ============================================================
// decisionLifecycle — did acting on a verdict help? (PURE)
// ============================================================
// When the engine replaces a verdict, the one being replaced gets resolved:
// compare how the entity was performing when the verdict was ISSUED against how
// it performs now. No I/O, no clock — the caller supplies both sides.
//
// This answers a narrow question and must not be read as more than it is. It is
// CORRELATIONAL: it says the entity improved after a KILL verdict was raised,
// not that the KILL caused it, and not that anyone acted on it. The intentAt
// column is what separates "a verdict nobody touched" from "a verdict a human
// went and acted on" — getSimilarOutcomes gates on it for exactly that reason.
//
// UNKNOWN is a real answer here, not a fallback. A decision with no metric on
// either end cannot be scored, and saying so is the whole point.
// ============================================================

/** Verdicts asking for an intervention — scored on engagement recovery. */
const ENGAGEMENT_VERDICTS = new Set(['KILL', 'REALLOCATE', 'REFRESH']);

// A metric must move by more than this to count as movement at all. Ad metrics
// wander a few percent between syncs on noise alone; without a band, every
// decision would resolve IMPROVED or WORSENED and none would ever be UNCHANGED.
export const MATERIAL_CHANGE = 0.10; // ±10%

const real = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * PURE: classify the change between a verdict's issue-time metrics and now.
 *
 * @param {string} verdict — the verdict being RESOLVED (not the new one)
 * @param {{ctr?:number|null, roas?:number|null}} at    — metrics when issued
 * @param {{ctr?:number|null, roas?:number|null}} now   — metrics now
 * @returns {'IMPROVED'|'UNCHANGED'|'WORSENED'|'UNKNOWN'}
 */
export function computeResolution(verdict, at = {}, now = {}) {
  // SCALE is judged on whether the return SURVIVED the extra budget, so it needs
  // roas on both ends. Everything else is judged on engagement recovery (ctr).
  // A verdict scored on the metric it was never about would be noise wearing a
  // verdict's name.
  const useRoas = verdict === 'SCALE';

  const before = useRoas ? at?.roas : at?.ctr;
  const after = useRoas ? now?.roas : now?.ctr;

  // No baseline (pre-lifecycle row), no current reading, or a zero baseline that
  // makes a ratio meaningless — none of these are scoreable.
  if (!real(before) || !real(after) || before <= 0) return 'UNKNOWN';

  // A verdict outside both families (HOLD / WATCH) asked for no intervention, so
  // there is no action whose effect could be measured.
  if (!useRoas && !ENGAGEMENT_VERDICTS.has(verdict)) return 'UNKNOWN';

  const ratio = after / before;
  if (ratio > 1 + MATERIAL_CHANGE) return 'IMPROVED';
  if (ratio < 1 - MATERIAL_CHANGE) return 'WORSENED';
  return 'UNCHANGED';
}

/**
 * PURE: the CTR movement in percentage POINTS, or null when either end is
 * missing. Points, not percent-of-percent: CTR is already a percentage, so
 * "1.64 → 1.20" is a fall of 0.44 points. Expressing it as -27% would be a
 * second-order number the column name does not promise.
 */
export function ctrDelta(at = {}, now = {}) {
  if (!real(at?.ctr) || !real(now?.ctr)) return null;
  return now.ctr - at.ctr;
}
