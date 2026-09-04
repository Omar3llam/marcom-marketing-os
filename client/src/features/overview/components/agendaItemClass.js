// ============================================================
// What an agenda item's decision class is CALLED (C-10)
// ============================================================
// The class arrives on the wire as a token. This turns it into the one word a
// reader sees, and nothing else — no colour, no icon, no ordering. What a class
// LOOKS like is B8-02's question; what it IS arrives already decided, which is
// the only part C-10 owns.
//
// ── WHY THERE IS NO PARSER HERE ─────────────────────────────────────────────
// Two agenda rows about one campaign, both reading KILL, are a performance
// verdict and a policy breach. On trunk they published with the same type,
// title and severity and no `rootCause` at all, so the client could not tell
// them apart — and the tools it would have reached for are all wrong ones:
// parse a string, infer from the verdict, guess from the title. Each is a
// second classifier, and the third one always disagrees with the first two.
// ============================================================
import { DECISION_CLASS } from '@marcom/runtime-contracts';

const LABEL = Object.freeze({
  [DECISION_CLASS.SIGNAL]:     'Verdict',
  [DECISION_CLASS.GUARDRAIL]:  'Guardrail',
  [DECISION_CLASS.ALLOCATION]: 'Budget move',
  [DECISION_CLASS.EXPERIMENT]: 'Experiment',
});

/**
 * The label for a decision class, or **null** when there is nothing to say.
 *
 * Null for three different reasons, and all three deserve silence rather than a
 * guess: the item is not decision-derived (a fatigue forecast, a pacing alert);
 * the row predates the class column and could not be classified; or a newer
 * backend shipped a fifth class this client has never heard of.
 *
 * C-07's degradation rule, unchanged — silence about a thing is honest, and a
 * confident wrong label is not.
 */
export function decisionClassLabel(decisionClass) {
  return LABEL[decisionClass] ?? null;
}
