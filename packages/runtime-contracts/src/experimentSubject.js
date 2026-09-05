// ============================================================
// EXPERIMENT_SUBJECT — which live object an Experiment item is about (C-13)
// ============================================================
// R-3 unified Test and Incrementality into ONE Decision class, and R-A ruled
// that the class enters Attention through its LIVE object rather than by
// promoting its historical Decision into current state.
//
// Both of those are settled. What neither answers is the question a reader
// holding an Experiment attention item has to answer next:
//
//     WHICH live object is this, out of the two the class contains?
//
// The class is EXPERIMENT for both. The tables, the routes, the readouts and
// the pages are different for each. So the item carries its class AND its
// subject, and they are not the same fact:
//
//     decisionClass: EXPERIMENT          what KIND of call this is
//     subjectRef:    { kind, id }        WHICH row it is about
//
// ── WHY IT LIVES IN THIS PACKAGE ────────────────────────────────────────────
//
// C-07's rule, applied rather than assumed: a vocabulary belongs here when the
// CLIENT must branch on its values. It must, today — `agendaItemRoute` sends a
// holdout to /app/measure and an A/B test to /app/testing, and those are the
// pages that list them. A client that had to infer the kind would reach for the
// tools C-10 named as always wrong: parse the id prefix, guess from the title,
// or infer from severity. Each is a second classifier, and the third one always
// disagrees with the first two.
//
// The contrast is deliberate. C-12 kept VERDICT_AGREEMENT and DRILL_BASIS on
// the backend because no client branched on them yet. Shipping a vocabulary
// with no reader is the shape C-18 warned about; this one has its reader in the
// same slice.
//
// ── WHY NOT A C-06 SUFFIX ───────────────────────────────────────────────────
//
// C-06's ratchet claims `_STATUS`, `_STATE`, `_REASON`, `_RUN`, and every
// vocabulary inside that jurisdiction must map each value to one of the five
// knowledge tokens. `_SUBJECT` is outside it, and correctly so: naming which
// row an item is about reports nothing about what Lumi KNOWS. Whether the
// holdout can be read is a separate question with a separate answer. Third
// application of the reasoning C-18 used for `_OUTCOME` and C-10 for `_CLASS`.
// The 32-symbol census is untouched.
// ============================================================

export const EXPERIMENT_SUBJECT = Object.freeze({
  /** `TestExperiment` — an A/B test between variants. Lists on /app/testing. */
  AB_TEST: 'AB_TEST',
  /** `IncrementalityTest` — a causal holdout. Lists on /app/measure. */
  HOLDOUT: 'HOLDOUT',
});

export const EXPERIMENT_SUBJECT_VALUES = Object.freeze(Object.values(EXPERIMENT_SUBJECT));

export function isExperimentSubject(value) {
  return EXPERIMENT_SUBJECT_VALUES.includes(value);
}
