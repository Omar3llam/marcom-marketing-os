// ============================================================
// decisionSuccess — the ONE answer to "was this call right?"
// ============================================================
// R10 (I53). Before this module there were two answers, from two engines, over
// the same table:
//
//   Proof Engine    → SUCCESS_PREDICATES[verdict](outcome, cfg)
//                     verdict-relative: a successful KILL SPENDS LESS, a
//                     successful SCALE returned more AND held, a HOLD is right
//                     if nothing moved materially.
//
//   Pattern Engine  → outcome.sustained === true
//                     one rule for every verdict.
//
// The divergence was known and documented in PatternService as "a live product
// question". It is not a product question — it is two systems disagreeing about
// whether Lumi was right about the same decision, and the disagreement is
// systematic rather than random: `sustained` alone marks a correct KILL wrong
// whenever revenue fell (which a correct KILL causes), and marks a REALLOCATE
// right on a single held day.
//
// This module makes SUCCESS_PREDICATES authoritative for both. It does not move
// them, does not re-implement them, and does not change what they mean. It is
// the shared reading of them, at one seam.
//
// WHAT IT ADDS ON TOP OF THE PREDICATES
//   The predicates alone are not the whole rule. The Proof Engine's scoring loop
//   applies three gates BEFORE reaching for one, and a caller that skipped them
//   would get a different answer from the same predicate:
//
//     1. SCORABLE_VERDICT — a WATCH claims nothing, so it cannot be wrong.
//     2. classifyMaturity — an outcome whose window is still open is not a
//        result yet, and scoring it would mark recent decisions worse purely
//        for being recent (§2.2's manufactured "degrading" signal).
//     3. predicate → null — mature, but missing the field the predicate needs.
//
// All three land on UNMEASURED here. THREE STATES, NEVER TWO: an unmeasured
// decision is not a failed one, and collapsing them is how a learning system
// teaches itself that everything it has not checked went badly.
//
// PURE. No DB, no clock of its own — `now` is injected, exactly as the engine
// injects it, so the same inputs always give the same answer.
// ============================================================
import {
  SUCCESS_PREDICATES, SCORABLE_VERDICT, MATURITY, DEFAULT_CONFIG,
} from './accuracyTypes.js';
import { classifyMaturity } from './decisionAccuracyEngine.js';

/**
 * The three states a decision's realized correctness can be in.
 *
 * UNMEASURED is a real answer, not a gap-filler — it is what an honest learning
 * population records for a call whose result is not yet established.
 */
export const DECISION_SUCCESS = Object.freeze({
  SUCCESS:    'SUCCESS',
  FAILURE:    'FAILURE',
  UNMEASURED: 'UNMEASURED',
});

/**
 * PURE: evaluate one decision against its CURRENT outcome, using the canonical
 * predicates.
 *
 * @param {{verdict:string, createdAt:Date|string,
 *          humanExecutedAt?:Date|string|null,
 *          platformExecutedAt?:Date|string|null}} decision
 *   The two provenance columns, NOT the deprecated `executedAt`. classifyMaturity
 *   opens the outcome window at the earlier of them (decisionProvenance
 *   .interventionAt) and falls back to `createdAt` when neither is present — so a
 *   caller that passes `executedAt`, as this contract used to ask for, silently
 *   anchors every maturity decision to issuance instead. Select them together
 *   via PROVENANCE_SELECT.

 * @param {object|null} outcome — the CURRENT OutcomeSnapshot (supersededAt null),
 *   or null when none has been recorded. Callers must resolve "current"
 *   themselves via outcomeSelection — this module does not query.
 * @param {{ now?: Date, config?: object }} [opts]
 * @returns {'SUCCESS'|'FAILURE'|'UNMEASURED'}
 */
export function evaluateDecisionSuccess(decision, outcome, { now = new Date(), config } = {}) {
  if (!decision) return DECISION_SUCCESS.UNMEASURED;
  const cfg = { ...DEFAULT_CONFIG, ...(config ?? {}) };

  // A verdict that asserted nothing cannot be graded. WATCH says "I am not
  // deciding yet"; grading it is a category error, not a missing measurement —
  // but UNMEASURED is still the right bucket, because the caller's question is
  // "do I have a result to learn from", and the answer is no either way.
  if (!SCORABLE_VERDICT[decision.verdict]) return DECISION_SUCCESS.UNMEASURED;

  const maturity = classifyMaturity(decision, outcome ?? null, new Date(now).getTime(), cfg);
  if (maturity !== MATURITY.SCORED) return DECISION_SUCCESS.UNMEASURED;

  const predicate = SUCCESS_PREDICATES[decision.verdict];
  if (!predicate) return DECISION_SUCCESS.UNMEASURED;

  // null from a predicate means "mature, but the field I grade on is absent" —
  // the Proof Engine counts that as UNSCORABLE, and so does this.
  const ok = predicate(outcome, cfg);
  if (ok == null) return DECISION_SUCCESS.UNMEASURED;

  return ok ? DECISION_SUCCESS.SUCCESS : DECISION_SUCCESS.FAILURE;
}

/**
 * PURE: the tri-state as the boolean-or-null the pattern engine's observation
 * rows carry (`correct`).
 *
 * true = right, false = WRONG AND COUNTED, null = not measured and excluded.
 * The middle value is the one that matters: I46 requires failures to stay in the
 * learning population, and a mapping that turned FAILURE into null would let a
 * pattern accumulate only its wins and call the result an accuracy.
 */
export function successToCorrect(state) {
  if (state === DECISION_SUCCESS.SUCCESS) return true;
  if (state === DECISION_SUCCESS.FAILURE) return false;
  return null;
}
