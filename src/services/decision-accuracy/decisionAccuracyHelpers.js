// ============================================================
// decisionAccuracyHelpers — what "actioned" means, in one place
// ============================================================
// PURE. No DB, no clock, no I/O.
//
// The Proof Engine used to ask `status === 'EXECUTED'`. Nothing ever wrote that
// status, so every gate matched an empty set and the whole surface reported on
// zero rows without erroring. The human signals (PR#326) are TIMESTAMPS —
// executedAt / dismissedAt — and these predicates are the only place that
// definition lives.
//
// WHY A MODULE AND NOT SIX INLINE CHECKS:
//   "Has this been actioned?" is a provenance question, and provenance is the
//   thing most likely to get stricter. A later revision may want a Meta action id
//   to corroborate the claim, or a verifiedAt, or to stop trusting a self-report
//   on a decision the operator never opened. Every one of those is a change to
//   this file and to nothing else. Six inline `executedAt != null` checks would
//   each have to be found, and the one that was missed would silently keep
//   counting rows the others had started excluding.
//
// STATUS IS NOW A VIEW, NOT THE TRUTH.
//   deriveAccuracyStatus projects the timestamps back onto the legacy vocabulary
//   the pure engine speaks. That is deliberate: the engine's two status reads sit
//   beside the survivorship counter and the coverage note, and rewriting them to
//   read timestamps would mean touching the layer with the densest tests and the
//   subtlest arithmetic for no behavioural gain. The translation happens once, at
//   the seam where DB rows become engine inputs.
// ============================================================
import { wasActedOn } from '../execution/decisionProvenance.js';

/**
 * PURE: was this call acted on — by ANYONE?
 *
 * B4-A. `executedAt` split into `humanExecutedAt` (an operator's claim) and
 * `platformExecutedAt` (Lumi's confirmed mutation), and this predicate takes
 * the UNION of the two, deliberately.
 *
 * The Proof Engine's subject is whether LUMI'S RECOMMENDATION was right, not
 * who carried it out. A KILL executed by hand tests the KILL exactly as well as
 * one executed by the worker, so excluding self-reports would not make the
 * metric stricter — it would make it answer a different question on a smaller
 * population, and production's population is ENTIRELY self-reported (zero
 * execution requests exist). The surface would have gone quiet and read as
 * "accuracy improved" rather than "we stopped counting".
 *
 * Platform-only claims — anything asserting that LUMI executed something — must
 * use `wasPlatformExecuted` from decisionProvenance instead. That is a
 * different question and it has a different predicate.
 */
export const isExecuted = (d) => wasActedOn(d);

/** PURE: an operator said they looked at this call and chose not to act. */
export const isDismissed = (d) => d?.dismissedAt != null;

/**
 * PURE: a human made ANY call about this decision.
 *
 * The union, not "executed": a dismissal is survivorship data the coverage
 * report counts, and treating it as no-signal would quietly shrink the
 * denominator the accuracy claim rests on.
 */
export const isActioned = (d) => isExecuted(d) || isDismissed(d);

/**
 * PURE: the status vocabulary the accuracy ENGINE reads, derived from the
 * timestamps that actually carry the fact.
 *
 * The two signals are mutually exclusive at the write path (the routes 409 the
 * second one), so the order here only decides what happens to a row that somehow
 * carries both — and executed wins, because an action taken is a stronger fact
 * about the world than an intention not to.
 *
 * Falls through to the row's own `status` when neither signal is present. That
 * is what keeps this backward-compatible: a row that genuinely holds EXECUTED
 * (none do today, but the enum is real and a future writer may set it) still
 * reports EXECUTED, and a PROPOSED row still reports PROPOSED so the engine's
 * "not a realized prediction" branch keeps working.
 */
export const deriveAccuracyStatus = (d) => (
  isExecuted(d) ? 'EXECUTED'
    : isDismissed(d) ? 'DISMISSED'
      : d?.status
);
