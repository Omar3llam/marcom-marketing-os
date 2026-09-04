// ============================================================
// C-12 — the live verdict and the stored one, named and never reconciled
// ============================================================
// connectorVerdictService publishes both, deliberately:
//
//   verdict          live, recomputed on every read, persists nothing
//   decisionVerdict  stored, what Lumi committed to at a past sweep
//
// Its own words: "Two different questions, deliberately not reconciled here."
// That is right, and this module does not reconcile them either. It states, as
// one published fact, whether they agree — so that no client has to work it out
// and none can quietly pick one.
//
// The frontend collapsed them by omission: `decisionVerdict` is assigned at
// CampaignsView.jsx:420 and read by NO component. So the operator sees the LIVE
// verdict while their Execute / Dismiss / Judgment attaches to the STORED
// Decision, and nothing tells them the two can differ.
//
// ── THE RULE IS R-1's, VERBATIM ─────────────────────────────────────────────
//
//     Verdict equality alone determines agreement.
//     A confidence difference is NOT divergence.
//
// So confidence is not an input here. It is stated because the tempting
// implementation reaches for it, and `?? 0.5` on a null confidence is a defect
// this repository has already met once.
//
// ── AND B7-06 BOUNDS WHAT MAY BE DONE WITH IT ───────────────────────────────
// Then and Now are never shown side by side as a diff — "a comparison asks
// which is right, and both are". This makes the divergence READABLE and NAMED.
// Rendering it is B8's ruling, and nothing here presumes it.
//
// ── WHY THIS VOCABULARY IS NOT IN THE SHARED PACKAGE ────────────────────────
// C-07's rule puts a vocabulary there when the CLIENT must branch on its
// values. No client branches on this one yet — the display ruling belongs to
// B8. Shipping it to the shared package now would be publishing a vocabulary
// with no reader, which is the shape C-18 warned about. It moves the day a
// client needs it, and not before.
//
// `_AGREEMENT` sits outside C-06's `_STATUS|_STATE|_REASON|_RUN`, like `_CLASS`
// (C-10) and `_OUTCOME` (C-18): it reports the SUBJECT, not our position.
// ============================================================
import { KNOWLEDGE } from '@marcom/runtime-contracts';

/** Whether today's read and the stored commitment say the same thing. */
export const VERDICT_AGREEMENT = Object.freeze({
  /** The same verdict. Confidence may differ freely — R-1. */
  AGREES: 'AGREES',
  /** Different verdicts. A FACT about two honest answers, not a correction. */
  DIVERGES: 'DIVERGES',
});

/** The token values, for validation and exhaustive tests. */
export const VERDICT_AGREEMENT_VALUES = Object.freeze(Object.values(VERDICT_AGREEMENT));

/**
 * PURE: the agreement between a live verdict and the stored decision, beside
 * what we know about that answer.
 *
 * THE THREE CASES, AND WHY THE LAST TWO MUST NOT SHARE A SPELLING:
 *
 *   a stored decision exists      KNOWN + AGREES | DIVERGES
 *   there is none                 NOTHING_THERE — a finding about the account.
 *                                 A campaign can have a live verdict and no
 *                                 stored decision at all: the feed recomputes
 *                                 from the entity graph every read, and
 *                                 Decision rows come only from a sweep.
 *   the identity read FAILED      COULD_NOT_LOOK — a statement about US.
 *
 * getLatestDecisions swallows its own failure and returns an empty map, which
 * is correct for the button (the by-entity path still works) and fatal for this
 * claim: built over silently, it would publish "Lumi has never decided about
 * this campaign" on the strength of our own outage. C-03's ruling, one object
 * over — which is why `ok` is a required input and not an optional hint.
 *
 * @param {object} args
 * @param {{verdict: string}} args.live — today's verdict for this entity
 * @param {{verdict: string}|null} args.stored — the stored decision, or null
 * @param {boolean} args.ok — did the identity read succeed?
 * @returns {{value: string|null, knowledge: string}}
 */
export function agreementOf({ live, stored, ok }) {
  // Checked FIRST, and ahead of `stored`. A failed read means the population we
  // are comparing against is not the population that exists, so even a row that
  // did arrive describes a partial answer. Publishing a partial answer as a
  // whole one is the failure mode here — not the missing row.
  if (!ok) return { value: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK };

  if (!stored?.verdict) return { value: null, knowledge: KNOWLEDGE.NOTHING_THERE };

  // Verdict equality alone. Neither side is rewritten by the comparison: "Lumi
  // said KILL" stays true even when today's read says SCALE, which is the whole
  // reason this is a published fact rather than a correction.
  const value = live?.verdict === stored.verdict
    ? VERDICT_AGREEMENT.AGREES
    : VERDICT_AGREEMENT.DIVERGES;

  return { value, knowledge: KNOWLEDGE.KNOWN };
}
