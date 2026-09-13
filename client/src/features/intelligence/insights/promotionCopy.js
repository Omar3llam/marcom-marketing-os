// ============================================================
// promotionCopy — one sentence per promotion outcome (C-18)
// ============================================================
// 🔒 C-18. The server names what a promotion DID; this module is the only place
// that turns that into words.
//
// ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
// One sentence covered all three outcomes:
//
//     Promoted — {n} proposed move{s}. Confirm {it|them} in Decisions to execute.
//
// With n = 0 — which happens when the approved mix matches current spend, and
// again on any repeat click — that reads as an instruction to go to a queue and
// confirm something that is not there. The plan looks half-finished and the
// operator goes looking for work that does not exist.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
// Same split C-03 set and C-07 reused: the SERVER owns the fact, the CLIENT owns
// the wording. So the strings live here and `PROMOTION_OUTCOME` lives in
// @marcom/runtime-contracts, and an unrecognised outcome degrades to "it
// happened" with NO next step rather than to a confident wrong one.
// ============================================================
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';

const plural = (n) => (n === 1 ? '' : 's');

const COPY = {
  [PROMOTION_OUTCOME.PROMOTED]: (r) => ({
    tone: 'success',
    message: `Promoted — ${r.decisionsCreated} proposed move${plural(r.decisionsCreated)}. `
      + `Confirm ${r.decisionsCreated === 1 ? 'it' : 'them'} in Decisions to execute.`,
  }),
  [PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES]: () => ({
    tone: 'success',
    // No count, and nowhere to send anyone. The approved mix asked for nothing,
    // which is a complete and successful promotion.
    message: 'Promoted — this plan is now in force. Its mix already matches what you are spending, so there is nothing to confirm.',
  }),
  [PROMOTION_OUTCOME.PROMOTED_MOVES_NOT_MEASURABLE]: () => ({
    tone: 'neutral',
    // Zero moves for a different reason than the sentence above: nothing could
    // be sized. Saying the mix "matches what you are spending" here would be a
    // claim about spend nobody measured over this plan's period.
    message: 'Promoted — this plan is now in force. No budget moves were staged: Lumi has not measured spend over this plan’s period, so it will not size them.',
  }),
  [PROMOTION_OUTCOME.ALREADY_PROMOTED]: (r) => ({
    tone: 'neutral',
    message: r.promotedAt
      ? `This plan was already promoted on ${formatDay(r.promotedAt)}. Nothing was created just now.`
      : 'This plan was already promoted. Nothing was created just now.',
  }),
};

function formatDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime())
    ? 'an earlier date'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * @param {{outcome: string, decisionsCreated: number, promotedAt: string|Date|null}|null} result
 * @returns {{tone: string, message: string}|null} null when there is nothing to
 *   report — an empty banner is not an outcome.
 */
export function promotionCopyFor(result) {
  if (!result) return null;
  const write = COPY[result.outcome];
  if (!write) {
    // An outcome this build does not know. Say the safe half — something was
    // promoted — and claim nothing about moves or where to go next.
    return { tone: 'neutral', message: 'Promoted.' };
  }
  return write(result);
}

/**
 * Has this plan been promoted?
 *
 * BOTH columns, and not for symmetry: a promotion whose mix asked for no moves
 * writes no AllocationPlan, so `allocationPlanId` is null on a plan that is
 * genuinely promoted — and a plan promoted before C-18 has the id and no
 * timestamp. One is the record, the other is all that was left behind.
 */
export function isPromoted(plan) {
  return !!(plan?.promotedAt || plan?.allocationPlanId);
}
