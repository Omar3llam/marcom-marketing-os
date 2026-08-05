// ============================================================
// counterfactualEngine — Stage 3: why NOT the alternatives
// ============================================================
// Public API: buildCounterfactuals(hypotheses)
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no randomness, no clock.
//
// ISOLATION CONTRACT:
//   Never writes to DB / enqueues / calls routes. Emits no verdict.
//
// INPUT IS HYPOTHESES, NOT SIGNALS:
//   `declined` is deliberately NOT a parameter. Every contradiction was already
//   computed once, in the projector, against MECHANISM_SUPPORT — re-deriving it
//   here would mean a second implementation of "does this healthy reading argue
//   against that mechanism", and two implementations of one predicate disagree
//   the first time either is tuned. This file reads what Stage 2 concluded and
//   never re-opens it.
//
// WHAT A COUNTERFACTUAL IS:
//   Not "the alternative is false" — an elimination that overclaims is worse
//   than none. It is the two honest halves of a comparison:
//     rejectedBy       — measurements that argue against the alternative
//     preferredBecause — what the PRIMARY rests on that the alternative's own
//                        mechanism cannot account for
//   Either may be empty. An empty pair is a real state ("we prefer this one but
//   can name no measurement that separates them"), and it is stated as empty
//   rather than filled with a plausible-sounding sentence.
// ============================================================
import { MECHANISM_SUPPORT } from '../diagnosis-engine/diagnosisTypes.js';

/**
 * PURE: does this counterfactual actually say anything?
 *
 * Both halves empty means an alternative was set aside while naming no reason.
 * That is a TRUE description of what the engine found, so it is built and kept
 * on the node — but publishing it as an argument would state a conclusion
 * nothing supports, so the payload projection filters on this.
 *
 * Lives here rather than in the projection because it is a statement about what
 * a counterfactual IS, and a second copy of that judgement elsewhere would drift
 * from this one.
 */
export const isSubstantive = (cf) =>
  (cf?.rejectedBy?.length ?? 0) > 0 || (cf?.preferredBecause?.length ?? 0) > 0;

/**
 * PURE: explain each alternative hypothesis against the primary one.
 *
 * ── ON "PRIMARY" ────────────────────────────────────────────────────────────
 * The primary is `hypotheses[0]` — POSITIONALLY, whatever ranking the caller
 * handed over. Today that is the diagnosis engine's order, which sorts by the
 * RULE's frozen confidence (0.85 → 0.70), NOT by the derived
 * `confidence.reasoning` the projector computes. The two can disagree: a
 * contradicted CREATIVE_FATIGUE scores 0.55 while an uncontradicted
 * INEFFICIENT_SCALING below it scores 0.95, and there is a test that builds
 * exactly that from the real engine.
 *
 * Re-sorting on `confidence.reasoning` here would change which mechanism the
 * whole comparison is anchored to — and that number is deliberately not wired
 * into any decision yet. This function ranks nothing; it explains the ranking
 * it was given. When reasoning confidence does become the ranking, it changes
 * at the source and this file needs no edit.
 *
 * @param {Array<object>} hypotheses — projectHypotheses() output, ranked.
 * @returns {Array<{mechanism, labelKey, rejectedBy, preferredBecause, confidence}>}
 *   `[]` for fewer than two hypotheses: with nothing to compare against, there
 *   is no alternative to reject, and a "counterfactual" over one candidate
 *   would be an argument with no opponent.
 */
export function buildCounterfactuals(hypotheses) {
  if (!Array.isArray(hypotheses) || hypotheses.length < 2) return [];

  const primary = hypotheses[0];
  // The primary's supporting rows in full — { metric, value, benchmark,
  // severity } — not just their names. A counterfactual that says "CTR" is
  // unreadable; one that says CTR 0.7% against a 1.5% bar can be checked.
  const primaryObserved = Array.isArray(primary?.observed) ? primary.observed : [];

  return hypotheses.slice(1).map((h) => {
    // Carried from Stage 2 verbatim. See the header: not re-derived.
    const rejectedBy = Array.isArray(h?.contradicts) ? h.contradicts : [];

    // Evidence the primary rests on that lies OUTSIDE the alternative's own
    // mechanism — the measurements this alternative, if true, would leave
    // unexplained. A reading the alternative also covers separates nothing and
    // is excluded: citing it would make the comparison look decisive on
    // evidence that points equally at both.
    const altSupport = MECHANISM_SUPPORT[h?.id] ?? [];
    const preferredBecause = primaryObserved.filter((obs) => !altSupport.includes(obs.metric));

    return {
      mechanism: h?.id ?? null,
      labelKey:  h?.labelKey ?? null,
      rejectedBy,
      preferredBecause,
      // The ALTERNATIVE's confidence, as Stage 2 scored it — never recomputed.
      // What the reader needs is how strong the thing being set aside was.
      confidence: h?.confidence ?? null,
    };
  });
}
