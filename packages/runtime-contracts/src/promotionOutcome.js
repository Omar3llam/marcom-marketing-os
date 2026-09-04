// ============================================================
// PROMOTION_OUTCOME — what a plan promotion actually did (C-18)
// ============================================================
// 🔒 C-18. Promoting a plan can end three ways, and until this vocabulary they
// all crossed the wire as a count:
//
//     { decisionsCreated: 2 }                       moves were staged
//     { decisionsCreated: 0 }                       the mix asked for none
//     { decisionsCreated: 0, alreadyPromoted: true } nothing happened at all
//
// `alreadyPromoted` had zero readers, so the second and third reached the
// client as the first, and it printed:
//
//     "Promoted — 0 proposed moves. Confirm them in Decisions to execute."
//
// C-07 measured that a token cannot replace a reason. This is the same lesson
// one object over: a COUNT cannot carry an outcome. Zero moves is not a smaller
// version of two moves — it is a different thing that happened.
//
// ── WHY _OUTCOME AND NOT _STATUS ────────────────────────────────────────────
//
// C-06's ratchet has a declared jurisdiction — `_STATUS`, `_STATE`, `_REASON`,
// `_RUN` — and every vocabulary inside it must declare which of the five
// knowledge tokens it carries. These three values carry none, because they are
// not about what Lumi knows. They are about what a call did. Naming this
// PROMOTION_STATUS would pull it into a ratchet that would then demand an
// epistemic claim it cannot honestly make, so the suffix is chosen and not
// inherited.
//
// ── WHY IT LIVES HERE ───────────────────────────────────────────────────────
//
// The rule C-07 set: a vocabulary belongs in this package when the CLIENT must
// branch on its values. It must — three outcomes, three different sentences,
// and only one of them may send a person to the Decisions queue.
// ============================================================

export const PROMOTION_OUTCOME = Object.freeze({
  /** The approved mix asked for budget moves, and they are staged as PROPOSED Decisions. */
  PROMOTED: 'PROMOTED',
  /**
   * The approved mix matches what is already being spent. A real promotion —
   * the plan is now in force — with nothing to confirm anywhere. No
   * AllocationPlan row is written for it, because a row published as "open,
   * awaiting your confirm" that contains no moves is a claim about work that
   * does not exist.
   */
  PROMOTED_WITH_NO_MOVES: 'PROMOTED_WITH_NO_MOVES',
  /** This plan was already promoted. Nothing was created by this call. */
  ALREADY_PROMOTED: 'ALREADY_PROMOTED',
});

export const PROMOTION_OUTCOME_VALUES = Object.freeze(Object.values(PROMOTION_OUTCOME));

/** True for a declared outcome, false for anything else — including null. */
export function isPromotionOutcome(value) {
  return PROMOTION_OUTCOME_VALUES.includes(value);
}
