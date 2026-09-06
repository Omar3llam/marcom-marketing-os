// ============================================================
// MARCOM Design System — Absence States (B8-02)
// ------------------------------------------------------------
// RULING (Omar, 2026-09-06): absence is a MEASURED SEMANTIC STATE, never a UI
// default. The presentation layer may not originate an absence, and may not
// choose a fallback when handed one. It renders what was measured, or it
// renders the fact that nothing was.
//
// THIS MODULE INVENTS NOTHING. C-06 froze the epistemology in
// @marcom/runtime-contracts, and 15 backend vocabularies already declare a
// `knowledgeOf()` for every value they can carry. All this does is turn a token
// the backend MEASURED into a shape a surface can render — the same job
// `signals.js` does for verdicts.
//
//     token   → the SHAPE  (which state, which tone, whether a retry is honest)
//     reason  → the COPY   (what this particular absence means, right here)
//
// ── WHY SIX AND NOT FIVE ────────────────────────────────────────────────────
// `NOTHING_FOUND` is a FINDING, not an absence. "We looked and there is
// nothing" is an ANSWER; "not enough to say" is not. Collapsing the two is the
// defect C-03 and C-07 both exist to end, and it is why `isAbsent()` answers
// false for it.
//
// ── WHY THE ADAPTER THROWS ──────────────────────────────────────────────────
// A default here would be C-16's `?? 0.5` and C-09's `below(null) === false`
// relocated to the view layer: it would render an unknown epistemic position as
// a known one. There is no safe fallback for "we do not know what we know".
// ============================================================
import { KNOWLEDGE } from '@marcom/runtime-contracts';

/** The six states a surface may be in about a single claim. */
export const ABSENCE = Object.freeze({
  /** We looked, and the claim can be made. Render the value. */
  PRESENT: 'PRESENT',
  /** The read failed, or no record of it exists. A retry is honest here. */
  NOT_REACHABLE: 'NOT_REACHABLE',
  /** We established what there is, and it does not suffice. Time may fix it. */
  NOT_MEASURED: 'NOT_MEASURED',
  /** We looked, and there is nothing. A FINDING — state it as an answer. */
  NOTHING_FOUND: 'NOTHING_FOUND',
  /** The question does not apply here. Nothing the operator does will change it. */
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  /** We are not entitled to ask. The operator CAN change this one. */
  NOT_PERMITTED: 'NOT_PERMITTED',
});

export const ABSENCE_VALUES = Object.freeze(Object.values(ABSENCE));

/**
 * Reasons that mean "not entitled" rather than "does not apply".
 *
 * DECLARED HERE, and deliberately narrow, because no backend vocabulary
 * separates the two today — C-06 maps both to `CANNOT_ASK`, correctly, since
 * both are "we cannot ask". C-07 already measured why that is not enough on its
 * own: two of three gating reasons shared one token, and the client's defect
 * was printing the WRONG instruction, not printing none. When a backend
 * vocabulary carries the distinction, this set should be deleted in favour of
 * it rather than grown.
 */
export const ENTITLEMENT_REASONS = Object.freeze(new Set([
  'NOT_ENTITLED', 'PLAN_REQUIRED', 'ROLE_REQUIRED', 'SCORING_HIDDEN',
]));

/** PURE: is this state an ABSENCE, as opposed to an answer? */
export function isAbsent(state) {
  return state === ABSENCE.NOT_REACHABLE
    || state === ABSENCE.NOT_MEASURED
    || state === ABSENCE.NOT_SUPPORTED
    || state === ABSENCE.NOT_PERMITTED;
}

/**
 * PURE: turn a measured C-06 token into the state a surface renders.
 *
 * @param {object} input
 * @param {string} input.knowledge  a KNOWLEDGE token the backend MEASURED
 * @param {string} [input.reason]   the domain reason, where one exists
 * @returns {string} an ABSENCE value
 * @throws when the token is absent or unrecognised — see the header
 */
export function absenceState({ knowledge, reason } = {}) {
  switch (knowledge) {
    case KNOWLEDGE.KNOWN:          return ABSENCE.PRESENT;
    case KNOWLEDGE.COULD_NOT_LOOK: return ABSENCE.NOT_REACHABLE;
    case KNOWLEDGE.NOT_ENOUGH:     return ABSENCE.NOT_MEASURED;
    case KNOWLEDGE.NOTHING_THERE:  return ABSENCE.NOTHING_FOUND;
    case KNOWLEDGE.CANNOT_ASK:
      // Without a reason the honest answer is the one that promises least. A
      // wrong NOT_PERMITTED tells the operator to go buy something that will
      // not help; a wrong NOT_SUPPORTED only understates what they could do.
      return ENTITLEMENT_REASONS.has(reason) ? ABSENCE.NOT_PERMITTED : ABSENCE.NOT_SUPPORTED;
    default:
      throw new Error(
        `absenceState: "${knowledge}" is not a KNOWLEDGE token. Absence must be `
        + 'measured, not assumed — there is no safe default for an unknown '
        + 'epistemic position.',
      );
  }
}
