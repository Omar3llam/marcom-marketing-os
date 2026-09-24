// ============================================================
// planPromotionSnapshot — the approved mix, written whole and read whole (C-18)
// ============================================================
// 🔒 C-18, Ruling A: "الترقية هي تنفيذ لما تمت الموافقة عليه، وليست فرصة لإعادة
// تشغيل العقل." A promotion executes the thing that was approved. It is not an
// opportunity to run the reasoning again.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// `planToAllocationInput(plan)` returned two fields — the budget, and a
// hardcoded GROWTH_CEILING goal — and `commitAllocation` then recomputed the
// entire mix from `getBlendedTruth` plus whatever verdicts were current at the
// instant of the click. So:
//
//     approved on Tuesday      →  the mix Tuesday's data implied
//     promoted on Friday       →  the mix FRIDAY's data implies
//
// and nothing anywhere said the two were different. `Plan.channelMix` — which
// the schema calls "snapshot of the allocation preview" — had exactly one
// mention in the whole repository: the write. Not one reader, backend or client.
//
// Current truth has its place, and it is BEFORE the approval: truth moves, the
// plan goes stale, a new preview is built, a person approves that. Never during
// the execution of an approval already given.
//
// ── WHY THE SNAPSHOT HAD TO GROW ────────────────────────────────────────────
//
// `previewAllocation` produces six things. `buildPlan` stored three of them —
// allocations, currency, totalBudgetMinor — and dropped the goal, the projection
// and the reasoning trail. But `AllocationPlan.goalType` and
// `AllocationPlan.reasoning` are NOT NULL columns and the four projection floats
// are what the row means, so promoting the stored mix was not merely unwired: it
// was impossible without inventing them.
//
// The three missing fields go into `Plan.projections` — an existing Json column
// with a single writer — under a new `mix` key. `channelMix` keeps the
// allocations and keeps its shape, because widening a column that already has
// rows would give one name two meanings, and storing the allocations in both
// places would give one fact two homes that can drift.
//
// ── AND WHY A PLAN WITHOUT IT REFUSES ───────────────────────────────────────
//
// Every plan built before this contract has the allocations and none of the
// rest. Its moves are fully recorded; what it projected is not. The three ways
// out are: recompute (banned by Ruling A), invent (a fabricated reasoning trail
// in a column whose only meaning is the real one), or refuse and say what would
// end the refusal. C-07 settled which of those is honest, and the C-02 ruling on
// the legacy corpus settled it again: a migration must never pretend to know.
// ============================================================

import { SPEND_PERIOD_STATUS } from '../budget-period/spendPeriod.js';
import { MONETARY_STATUS, MONETARY_REASON } from '../../lib/operationalMonetary.js';
import { isSupportedCurrency } from '../../lib/currencyDetector.js';
import { EFFICIENCY_STATUS } from '../../lib/blendedRevenueEfficiency.js';

/** Typed refusals, so the route answers 409 rather than 500. */
export const PROMOTION_REFUSAL = Object.freeze({
  SNAPSHOT_INCOMPLETE: 'PlanSnapshotIncomplete',
  NOTHING_TO_PROMOTE:  'NothingToPromote',
  ACTOR_UNRESOLVED:    'ActorUnresolved',
  MONETARY_UNAVAILABLE: 'PlanMonetaryUnavailable',
});

/** The prerequisite that would end each refusal — C-07's law, one slice over. */
export const PROMOTION_PREREQUISITE = Object.freeze({
  [PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE]: 'REBUILD_PLAN',
  [PROMOTION_REFUSAL.NOTHING_TO_PROMOTE]:  'CONNECT_A_CHANNEL',
  [PROMOTION_REFUSAL.ACTOR_UNRESOLVED]:    'SIGN_IN_AGAIN',
  [PROMOTION_REFUSAL.MONETARY_UNAVAILABLE]: 'REBUILD_PLAN',
});

export function refusePromotion(code, message) {
  return Object.assign(new Error(message), {
    code,
    prerequisite: PROMOTION_PREREQUISITE[code] ?? null,
  });
}

/**
 * What `buildPlan` records about the preview BESIDES its allocations.
 *
 * Deliberately does not carry the allocations: `Plan.channelMix` is their one
 * home, and a second copy here could disagree with it.
 *
 * @param {object|null} mix a `previewAllocation` result
 * @returns {object|null} null when there was no mix to capture — a shell of
 *   zeroes would claim a projection that was never computed.
 */
export function captureMixSnapshot(mix) {
  if (!mix) return null;
  return {
    goal:             mix.goal ?? null,
    totalBudgetMinor: mix.totalBudgetMinor ?? null,
    currency:         mix.currency ?? null,
    monetaryStatus:   mix.monetaryStatus ?? MONETARY_STATUS.UNAVAILABLE_UNTRUSTED,
    monetaryReason:   mix.monetaryReason ?? null,
    efficiencyStatus: mix.efficiencyStatus ?? EFFICIENCY_STATUS.UNAVAILABLE,
    efficiencyReason: mix.efficiencyReason ?? null,
    projected:        mix.projected ?? null,
    reasoningTrail:   Array.isArray(mix.reasoningTrail) ? mix.reasoningTrail : null,
    // What the mix's moves were sized against — or why they were not. A mix
    // captured before this field existed has none, and promotion reads that as
    // "not measured", never as "measured".
    spendPeriod:      mix.spendPeriod ?? null,
  };
}

/** Every field `persistAllocation` needs and cannot derive. */
function snapshotIsComplete(snap) {
  return !!snap
    && !!snap.goal?.type
    && !!snap.projected
    && Array.isArray(snap.reasoningTrail)
    && Number.isFinite(snap.totalBudgetMinor);
}

/**
 * Rebuild the exact allocation a strategist approved, from the stored row.
 *
 * PURE, and that is the whole point: called twice a year apart, in a workspace
 * whose blended truth has completely turned over, it answers the same thing —
 * because the answer is a record, not a computation.
 *
 * @param {object} plan a Plan row
 * @returns {{goal, totalBudgetMinor, currency, allocations, projected, reasoningTrail}}
 * @throws a typed refusal — never a recomputation, never an invented field.
 */
export function planToAllocationCommit(plan) {
  const snap = plan?.projections?.mix ?? null;

  if (!snapshotIsComplete(snap)) {
    throw refusePromotion(
      PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE,
      'This plan does not record what its mix projected, so promoting it would have to invent that. Build a new plan and approve it.',
    );
  }

  const allocations = Array.isArray(plan.channelMix) ? plan.channelMix : [];
  // Pre-contract JSON contains merBefore/merAfter without proof. Never promote
  // those values into a current semantic metric or a budget move.
  if (snap.efficiencyStatus == null) {
    throw refusePromotion(PROMOTION_REFUSAL.SNAPSHOT_INCOMPLETE,
      'This legacy mix has no proven efficiency basis. Build a new plan before promotion.');
  }
  if (snap.monetaryStatus !== MONETARY_STATUS.VALID || !isSupportedCurrency(snap.currency)
    || snap.currency !== plan.currency || snap.spendPeriod?.status !== SPEND_PERIOD_STATUS.MEASURABLE
    || snap.spendPeriod?.currency !== snap.currency) {
    const err = refusePromotion(PROMOTION_REFUSAL.MONETARY_UNAVAILABLE,
      'This plan cannot prove the denomination of its approved allocation. Build a new plan with an explicit budget currency.');
    err.reason = snap.monetaryReason ?? MONETARY_REASON.SPEND_CURRENCY_UNTRUSTED;
    throw err;
  }
  if (allocations.length === 0) {
    // A complete snapshot that says "there were no channels to allocate". A
    // different fact from an incomplete one, and it gets its own name.
    throw refusePromotion(
      PROMOTION_REFUSAL.NOTHING_TO_PROMOTE,
      'This plan has no channels in its mix.',
    );
  }

  return {
    goal:             snap.goal,
    totalBudgetMinor: snap.totalBudgetMinor,
    currency:         snap.currency,
    monetaryStatus:   snap.monetaryStatus,
    monetaryReason:   null,
    efficiencyStatus: snap.efficiencyStatus,
    efficiencyReason: snap.efficiencyReason ?? null,
    allocations,
    projected:        snap.projected,
    reasoningTrail:   snap.reasoningTrail,
    spendPeriod:      snap.spendPeriod ?? null,
  };
}

/**
 * Does this approved mix ask for anything to change?
 *
 * `planToDecisionRows` filters `deltaMinor !== 0`, so a mix that matches current
 * spend mints no Decisions. That is a promotion with no moves — not a failure,
 * and not "0 moves to confirm".
 */
export function hasBudgetMoves(commit) {
  // `deltaMinor !== 0` alone let a null through. A move is a measured number.
  return budgetMovesAreMeasured(commit)
    && (commit?.allocations ?? []).some((a) => Number.isFinite(a?.deltaMinor) && a.deltaMinor !== 0);
}

/**
 * Were this mix's moves sized against spend over the budget period?
 *
 * False for a NOT_MEASURABLE period AND for a mix with no recorded period —
 * every plan approved before spend periods existed. Its deltas are numbers, but
 * numbers computed from a window nobody checked, and C-18 promotes verbatim.
 */
export function budgetMovesAreMeasured(commit) {
  return commit?.monetaryStatus === MONETARY_STATUS.VALID
    && commit?.efficiencyStatus === EFFICIENCY_STATUS.VALID
    && commit?.spendPeriod?.status === SPEND_PERIOD_STATUS.MEASURABLE;
}
