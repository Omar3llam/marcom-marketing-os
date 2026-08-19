// ============================================================
// decisionExecutability — can Lumi actually carry this verdict out?
// ============================================================
// R13-D / B3. The server answers this, once, and the surface renders the
// answer. The alternative is a React component re-deriving `verdictToActionType`
// plus ALLOWED_ACTIONS plus the endpoint builder's option requirements — a
// second copy of the execution contract, in the one place least able to keep up
// with it. B2 removed exactly that pattern from the account aggregates.
//
// THE RULE THIS ENFORCES (B3 §3):
//   Never offer Execute on something that would become a fake success.
//
// So this is deliberately CONSERVATIVE. It says yes only when a real Meta
// mutation can be built from what we already hold, with no further input from
// anybody. Every no carries a reason, because "we can't do this" and "we can't
// do this YET, and here is what's missing" are different things to a reader.
//
// ── WHY SO FEW VERDICTS QUALIFY ────────────────────────────────────────────
// metaExecutionService.buildRequest is the authority, and it splits cleanly:
//
//   PAUSE_* / RESUME_*   params derived from the action alone      → executable
//   *_BUDGET / SCALE     THROWS without options.dailyBudget        → not yet
//   REFRESH_CREATIVE     THROWS without a Meta options.creativeId  → not yet
//
// A SCALE verdict knows a campaign deserves more money; it does not know how
// much, and Lumi does not hold a creative library. Offering Execute on either
// would queue a request that fails in the worker with a 400 the operator never
// asked for — the click would look like an action and produce an error. So they
// report NEEDS_OPERATOR_INPUT and the surface keeps the honest self-report path.
//
// That leaves KILL → PAUSE_CAMPAIGN as the executable verdict today. That is not
// a limitation this module invents; it is the true extent of the mutation layer,
// stated once instead of discovered at runtime.
// ============================================================
import { verdictToActionType } from '../verdict-engine/verdictTypes.js';
import { ALLOWED_ACTIONS, isValidTargetId } from '../meta/mutationParams.js';

/** Channels with a real mutation implementation. Meta is the only one. */
export const EXECUTABLE_CHANNELS = Object.freeze(['META']);

/**
 * Actions metaExecutionService.buildRequest can build with NO caller-supplied
 * options. An ALLOW-LIST, not a deny-list: a new action added to the builder is
 * not executable from a verdict until somebody decides where its parameters come
 * from, which is exactly the review this list forces.
 */
export const SELF_CONTAINED_ACTIONS = Object.freeze([
  'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'PAUSE_ADSET', 'RESUME_ADSET',
]);

/** Why a verdict cannot be executed. Never a bare false. */
export const NOT_EXECUTABLE = Object.freeze({
  // No sweep has written a Decision for this campaign yet. Executing without
  // one would produce a real mutation the Proof Engine can never attribute.
  NO_DECISION:           'NO_DECISION',
  // The verdict asks for no intervention at all (HOLD / WATCH).
  NO_ACTION_FOR_VERDICT: 'NO_ACTION_FOR_VERDICT',
  // Google, TikTok, … — no mutation implementation exists for the channel.
  UNSUPPORTED_CHANNEL:   'UNSUPPORTED_CHANNEL',
  // The campaign has no platform-native id (pre-connector row), so there is
  // nothing to address on Meta.
  NO_PLATFORM_ID:        'NO_PLATFORM_ID',
  // A real action, but one that needs a number or an id a human must choose.
  NEEDS_OPERATOR_INPUT:  'NEEDS_OPERATOR_INPUT',
  // The action/target pair is not in the mutation allow-list.
  ACTION_NOT_ALLOWED:    'ACTION_NOT_ALLOWED',
});

/** Entity level → the `targetType` the mutation allow-list speaks. */
const TARGET_TYPE = Object.freeze({ CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad' });

const refuse = (reason) => Object.freeze({
  supported: false, actionType: null, targetId: null, targetType: null, reason,
});

/**
 * PURE: what, if anything, Lumi can execute for this verdict.
 *
 * @param {object} args
 * @param {string|null} args.verdict      — the STORED decision's verdict, not the live one
 * @param {string} [args.entityLevel]     — CAMPAIGN | ADSET | AD
 * @param {string|null} args.channel      — the campaign's channel
 * @param {string|null} args.externalId   — the platform-native id (Meta object id)
 * @param {string|null} args.decisionId   — the stored Decision this would carry out
 * @returns {{ supported: boolean, actionType: string|null, targetId: string|null,
 *             targetType: string|null, reason: string|null }}
 */
export function executabilityFor({
  verdict = null, entityLevel = 'CAMPAIGN', channel = null, externalId = null, decisionId = null,
} = {}) {
  // Attribution first, because it is the one refusal that is about US rather
  // than about the campaign: everything downstream could be perfectly
  // executable and we would still be producing an unattributable mutation.
  if (!decisionId) return refuse(NOT_EXECUTABLE.NO_DECISION);

  const actionType = verdictToActionType(verdict, entityLevel);
  if (!actionType) return refuse(NOT_EXECUTABLE.NO_ACTION_FOR_VERDICT);

  if (!channel || !EXECUTABLE_CHANNELS.includes(channel)) {
    return refuse(NOT_EXECUTABLE.UNSUPPORTED_CHANNEL);
  }

  // The id Meta addresses, which is NOT our entityId. A uuid here would be
  // rejected by the route's own validation — checked with the same predicate
  // the route and the worker use, so the three cannot disagree about what a
  // Meta object id is.
  const targetId = externalId == null ? null : String(externalId);
  if (!isValidTargetId(targetId)) return refuse(NOT_EXECUTABLE.NO_PLATFORM_ID);

  const targetType = TARGET_TYPE[entityLevel] ?? null;
  if (!targetType || !ALLOWED_ACTIONS[actionType]?.includes(targetType)) {
    return refuse(NOT_EXECUTABLE.ACTION_NOT_ALLOWED);
  }

  // Last, and the one that keeps the promise in this module's header: a real,
  // allowed, well-addressed action that still cannot be built without input we
  // do not have. Offered as a refusal WITH its actionType, so a surface can say
  // what it would have done.
  if (!SELF_CONTAINED_ACTIONS.includes(actionType)) {
    return Object.freeze({
      supported: false, actionType, targetId, targetType,
      reason: NOT_EXECUTABLE.NEEDS_OPERATOR_INPUT,
    });
  }

  return Object.freeze({ supported: true, actionType, targetId, targetType, reason: null });
}
