// ============================================================
// C-12 — what justifies going below the campaign
// ============================================================
// B8-04, locked:
//
//     A history of judgments about a subject, not a history of its metrics.
//     Entered by the subject, read as calls. EVERY DEEPER LAYER MUST NAME THE
//     CLAIM THAT BROUGHT YOU THERE.
//
// And the boundary is not design taste — it is already in the schema:
//
//   canonical verdict evidence   CAMPAIGN-level only
//   GuardrailRule.scopeLevel     @default(ADSET)
//   FatiguePrediction            keyed entityId:entityLevel
//
// So A PERFORMANCE VERDICT NEVER NAMES AN AD SET. Only a breach or a fatigue
// forecast does. On a campaign with neither there is no claim that reaches
// below it — and B8-04 says that is the rule working, not a gap.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
// Refuse the descent. The routes still serve. Hiding the affordance is B7's
// ruling, and enforcing it here would change shipped behaviour on a ruling
// nobody has made. This DECLARES; B7 decides what to do with the declaration.
//
// ── WHY THIS VOCABULARY IS BACKEND-ONLY ─────────────────────────────────────
// C-07: a vocabulary crosses into the shared package when the CLIENT must
// branch on its values. No client branches on this one yet — that is B7/B8's
// work. `_BASIS` is outside C-06's `_STATUS|_STATE|_REASON|_RUN` either way.
// ============================================================
import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger } from '../../utils/logger.js';

/**
 * The two claims that legitimately name an entity below a campaign.
 *
 * Each is the name of a REAL ROW TYPE — a guardrail episode (C-02's own term)
 * and a `FatiguePrediction` — rather than an abstract category. A category
 * would need its own definition; a row type already has one.
 */
export const DRILL_BASIS = Object.freeze({
  GUARDRAIL_EPISODE:  'GUARDRAIL_EPISODE',
  FATIGUE_PREDICTION: 'FATIGUE_PREDICTION',
});

/** PURE: one claim, as the entity it names. */
const claim = (kind) => (r) => ({ kind, entityId: r.entityId, entityLevel: r.entityLevel });

/**
 * The claims that reach below one campaign, beside what we know about them.
 *
 * THE TWO SILENCES, WHICH MUST NEVER SHARE A SPELLING:
 *
 *   NOTHING_THERE   we looked, and no claim reaches below this campaign. A
 *                   FINDING — and, under B8-04, the honest bottom of a campaign
 *                   with no breach and no forecast.
 *   COULD_NOT_LOOK  a claim read failed. Published as NOTHING_THERE it would
 *                   say "nothing justifies going deeper here" on the strength
 *                   of our own outage.
 *
 * A PARTIAL ANSWER IS NEVER PUBLISHED AS A WHOLE ONE. One read succeeding does
 * not rescue the other: the claims we found are not the claims that exist, and
 * KNOWN over them would assert that we had looked everywhere.
 *
 * Never throws. The descent works either way — it just cannot justify itself.
 *
 * @param {string} workspaceId
 * @param {string[]} childEntityIds — the ad-set ids of this campaign
 * @returns {Promise<{claims: object[], knowledge: string}>}
 */
export async function drillBasisFor(workspaceId, childEntityIds = []) {
  // Nothing to ask about. NOT "we could not look": a campaign with no ad sets
  // is at its honest bottom, and asking two queries about an empty id list
  // would spend two round trips to learn what the argument already said.
  if (!workspaceId || !Array.isArray(childEntityIds) || childEntityIds.length === 0) {
    return { claims: [], knowledge: KNOWLEDGE.NOTHING_THERE };
  }

  const where = { workspaceId, entityId: { in: childEntityIds } };

  // `.catch()` on each query handles a REJECTION. It does not handle a
  // synchronous throw while the promise is still being constructed — a missing
  // delegate, a client that failed to initialise — and that throw would escape
  // Promise.all and 500 the descent itself. The justification for going deeper
  // must never be able to take down the descent, so the whole block is guarded
  // and the failure lands where every other failure here lands: COULD_NOT_LOOK.
  let episodes, forecasts;
  try {
    [episodes, forecasts] = await Promise.all([
    // C-10 — scoped to GUARDRAIL by the ledger, not by whatever is newest. A
    // SIGNAL verdict on an ad set would not be a licence to descend: the
    // campaign-level judgement is not a claim ABOUT that ad set.
    //
    // `openHitKey NOT NULL` is C-02's open-episode predicate — closing a
    // breach sets RESOLVED and nulls the key, and a closed episode explains a
    // past descent without justifying one now.
      prisma.decision.findMany({
        where:  { ...where, ...scopeFor('drill-basis/guardrail-episodes'), openHitKey: { not: null } },
        select: { entityId: true, entityLevel: true },
      }).catch((err) => {
        logger.debug({ err: err.message, workspaceId }, '[drillBasis] guardrail episode read failed');
        return null;
      }),
    // Unresolved only, for the same reason: a forecast already confirmed or
    // invalidated is history.
      prisma.fatiguePrediction.findMany({
        where:  { ...where, resolvedAt: null },
        select: { entityId: true, entityLevel: true },
      }).catch((err) => {
        logger.debug({ err: err.message, workspaceId }, '[drillBasis] fatigue prediction read failed');
        return null;
      }),
    ]);
  } catch (err) {
    logger.debug({ err: err.message, workspaceId }, '[drillBasis] claim reads could not be issued');
    return { claims: [], knowledge: KNOWLEDGE.COULD_NOT_LOOK };
  }

  if (episodes === null || forecasts === null) {
    // No claims are published beside this. A list under COULD_NOT_LOOK would
    // invite a reader to treat it as the answer, which is what the token is
    // there to prevent.
    return { claims: [], knowledge: KNOWLEDGE.COULD_NOT_LOOK };
  }

  const claims = [
    ...episodes.map(claim(DRILL_BASIS.GUARDRAIL_EPISODE)),
    ...forecasts.map(claim(DRILL_BASIS.FATIGUE_PREDICTION)),
  ];

  return {
    claims,
    knowledge: claims.length > 0 ? KNOWLEDGE.KNOWN : KNOWLEDGE.NOTHING_THERE,
  };
}
