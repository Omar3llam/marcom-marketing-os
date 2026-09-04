// ============================================================
// DECISION_CLASS — what KIND of decision a Decision row is (C-10)
// ============================================================
// 🔒 C-10. Five writers put rows in the `decisions` table, and until this
// vocabulary the kind of row was a string PREFIX on `rootCause`, owned
// privately by each of them:
//
//     VerdictService          a signalType / rootCause / null
//     GuardrailSweepService   `guardrail:`      a bare literal, in three files
//     AllocationService       `allocation:`     a private const
//     IncrementalityService   `incrementality:` a private const named MEMORY_PREFIX
//     TestTrackerService      `test:`           a private const, declared TWICE
//
// `decisionIdentity.js` listed all five in a COMMENT and defined exactly one.
// The other four were defined by SUBTRACTION — a class was "not Signal".
//
// The measured cost: `NarrativeService` needed the class and wrote its own
// parser, `/^allocation:([0-9a-f-]+)/i`. When a consumer has to run a regex to
// learn what kind of row it is holding, the kind is not metadata hidden inside
// a string. It is identity, and identity gets a name.
//
// ── THE INVARIANT THIS EXISTS TO ENFORCE ────────────────────────────────────
//
//     A verdict may only be interpreted within the decision class that gives
//     that verdict its meaning.
//
// Measured, not theoretical. `AllocationService` read "the latest verdict per
// channel entity" with no class predicate, so under a standing breach the
// newest row was a guardrail episode from the 15-minute sweep, and a KILL there
// carries VERDICT_APPETITE 0.0 — the channel's budget drained to zero, with the
// plan's own reasoning trail publishing "Drain <ch>: KILL verdict — pull budget
// out." A policy breach is not a judgement about performance.
//
//     SIGNAL KILL ≠ GUARDRAIL KILL, even when the word is identical.
//
// ── WHY _CLASS AND NOT _STATUS ──────────────────────────────────────────────
//
// C-06's ratchet has a declared jurisdiction — `_STATUS`, `_STATE`, `_REASON`,
// `_RUN` — and every vocabulary inside it must say which of the five knowledge
// tokens each value carries. `_CLASS` is outside that list, so this registry is
// not claimed by the ratchet and the 32-symbol census is untouched.
//
// But the SUFFIX IS NOT THE ARGUMENT — C-06's own header says so, and says the
// suffix only makes a vocabulary visible. The argument is that C-06 answers
// "what does Lumi KNOW?" and this answers "what KIND of decision is this?".
// Two layers. A decision class reports nothing about our epistemic position:
// a GUARDRAIL row is not a weaker SIGNAL row, it is a different object. So the
// registry is independent by ruling, and the naming merely agrees with it.
// Second application of the reasoning C-18 used for `_OUTCOME`.
//
// ── WHY IT LIVES HERE ───────────────────────────────────────────────────────
//
// The rule C-07 set: a vocabulary belongs in this package when the CLIENT must
// branch on its values. It must. Two agenda rows about one campaign, both
// reading KILL, are today published with the same type, title and severity and
// no `rootCause` at all — so the client cannot tell a performance verdict from
// a policy breach, and B8-02's attention row needs the class to fill a slot.
// ============================================================

export const DECISION_CLASS = Object.freeze({
  /**
   * The connector verdict engine's own call about an entity's performance.
   * The only class whose rows are superseded, resolved, and admitted to the
   * learning and accuracy populations.
   */
  SIGNAL: 'SIGNAL',
  /**
   * A breach episode against user-asserted policy (C-02). One open episode per
   * (rule, entity), enforced by the database through `openHitKey`. Its verdict
   * states what the RULE says, never what the engine concluded.
   */
  GUARDRAIL: 'GUARDRAIL',
  /**
   * A budget move proposed by an allocation plan, linked to it through
   * `rootCause: allocation:<planId>`.
   *
   * Whether a REALLOCATE proposal should live in the `decisions` table at all
   * is a real and open architectural question — and it is NOT answered here.
   * `AllocationService` writes these rows today, so they have a class today.
   * C-10 describes what a Decision IS on trunk, not what we may later decide it
   * should be; deleting the classification of a row that exists would leave it
   * NULL, which means "unclassified" and would be a false statement about a
   * producer we know exactly.
   */
  ALLOCATION: 'ALLOCATION',
  /**
   * A conclusion drawn from a test. ONE class over two producers — `test:`
   * (TestTrackerService) and `incrementality:` (IncrementalityService) — which
   * are subtypes, kept where they have always been, on `rootCause`.
   *
   * They produce a Decision, cross a similar lifecycle, and are none of the
   * other three, so they share population semantics. Splitting them would
   * double the vocabulary with no consumer asking for the distinction.
   *
   * C-10 makes EXPERIMENT class-visible and population-safe. It does NOT make
   * EXPERIMENT learnable: nothing outside VerdictService writes `resolution`,
   * so an experiment row has no outcome to learn from. Admitting it needs a
   * producer that owns that outcome — the same shape as C-18's Ruling D.
   */
  EXPERIMENT: 'EXPERIMENT',
});

export const DECISION_CLASS_VALUES = Object.freeze(Object.values(DECISION_CLASS));

/** True for a declared class, false for anything else — including null. */
export function isDecisionClass(value) {
  return DECISION_CLASS_VALUES.includes(value);
}

// ── WHERE THE CLASSIFIER IS NOT ────────────────────────────────────────────
//
// There is deliberately no `classifyRootCause` here. Placing it in this package
// would force it to recognise a connector cause by SHAPE — an upper-snake string
// with no prefix — and that shape cannot tell a live enum member from one
// deleted last year. Both would classify as SIGNAL, which is precisely the
// invention T3 forbids: an unrecognised cause must answer null, not the
// commonest class.
//
// So the classifier lives in `src/services/decisions/decisionClassifier.js`,
// where it can be handed the real CONNECTOR_ROOT_CAUSES set. The client never
// classifies anything — it RECEIVES the class, which is the whole point.
