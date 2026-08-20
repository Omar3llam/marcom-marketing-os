// ============================================================
// MARCOM / Lumi — Decision history: "have we seen this before?"
// ------------------------------------------------------------
// ── WHY THIS IS NOT A METHOD ON DecisionMemoryService ───────────────────────
// That service reads the `DecisionMemory` model, which answers a DIFFERENT
// question. It is keyed by `executionId` (a required FK to ExecutionRequest),
// carries no `entityId` and no `decisionId`, and its only read is
// `getRecentMemories(workspaceId, limit)` — workspace-wide, with no entity
// scope at all. It remembers EXECUTIONS. Reusing it here would produce a
// timeline that is not about this campaign.
//
// `DecisionMemoryEntry` is closer (it has decisionId and entityId) but is the
// sustainability record — isSustainable / impactDurationHrs, written when a
// fatigue prediction resolves. Also not a decision history.
//
// The history of what Lumi decided about a campaign is the DECISION TABLE
// itself. This module reads it, and nothing else.
//
// ── HISTORICAL MEANS ALL STATUSES ──────────────────────────────────────────
// Deliberately NOT the `status: 'PROPOSED'` filter getLatestDecisions uses.
// That query answers "which row do I act on now"; this one answers "what have
// we said before", and a decision that has been SUPERSEDED, EXECUTED or
// DISMISSED is the entire point. Filtering to PROPOSED would leave a timeline
// that empties itself every sweep.
//
// Same connector scope as the write path, though: a guardrail hit and an
// allocation move are proposals about this campaign, not verdicts Lumi reached
// about it, and listing them as "we said KILL before" would be a fabrication.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { connectorDecisionScope } from '../verdict-engine/decisionIdentity.js';
import { PROVENANCE_SELECT, legacyExecutedAt } from '../execution/decisionProvenance.js';

/**
 * How many past decisions travel per campaign. A bound with an explicit
 * contract, set HERE rather than in a renderer: the count below is the TRUE
 * total, so a capped list never turns into a capped number on screen.
 */
export const HISTORY_LIMIT = 5;

// ── The workspace-scoped read (R7) ──────────────────────────────────────────
// getDecisionHistory above answers "what did we say about THESE campaigns".
// This one answers "what has Lumi decided lately, anywhere in this workspace" —
// the question the sidebar and the orchestrator's prompt both actually ask, and
// the one the retired DecisionMemory table used to answer badly.
//
// WHY IT IS NOT getDecisionHistory. That function takes entityIds and is
// correct for a campaign timeline. The orchestrator has no entityId to give it:
// it keys on CampaignState.campaignId, a plain legacy String, while
// Decision.entityId is a @db.Uuid from the entity graph. They are different
// identifier spaces, so entity-scoping this path would silently return nothing.
// Workspace scope is also what the read it replaces already had, which keeps
// this a migration rather than a redesign.
//
// ONE READ, TWO CONSUMERS. The select is the UNION of what they need, and no
// wider: the sidebar needs identity + verdict + when, the prompt needs the
// engine's reasoning. Splitting it into two near-identical queries is how a
// second source of decision truth starts.
export const RECENT_DECISIONS_LIMIT = 20;

/** The minimum both consumers require. Nothing here is decorative. */
export const RECENT_DECISION_SELECT = Object.freeze({
  id: true,          // sidebar: identity of the row it renders
  entityId: true,    // sidebar: what to resolve a name against
  entityLevel: true,
  verdict: true,
  status: true,
  diagnosis: true,   // prompt: what the engine concluded
  rootCause: true,   // prompt: why
  confidence: true,
  resolution: true,  // prompt: how it turned out, when known
  createdAt: true,
});

/**
 * Recent connector decisions across one workspace, newest first.
 *
 * Same connector scope as getDecisionHistory: a guardrail hit or an allocation
 * move is a proposal about a campaign, not a verdict Lumi reached about it, and
 * listing one as "we decided KILL" would be a fabrication.
 *
 * Ordering is deterministic — `createdAt` can tie when a sweep writes several
 * rows in one transaction, and an unstable tiebreak would let the same request
 * return a different three rows to the sidebar on each poll.
 *
 * Throws rather than swallowing: the two callers want DIFFERENT failure
 * behaviour (the prompt distinguishes "no decisions" from "could not read"),
 * and a service that decides that for them takes the choice away.
 *
 * @param {string} workspaceId
 * @param {number} [limit=RECENT_DECISIONS_LIMIT]
 * @returns {Promise<object[]>} newest first; [] when the workspace has none
 */
export async function getRecentDecisions(workspaceId, limit = RECENT_DECISIONS_LIMIT) {
  if (!workspaceId) return [];
  return prisma.decision.findMany({
    where:   { workspaceId, ...connectorDecisionScope() },
    select:  RECENT_DECISION_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take:    limit,
  });
}

/** PURE: the fields a timeline states, and nothing else. */
const stated = (d) => ({
  id:          d.id,
  verdict:     d.verdict,
  status:      d.status,
  createdAt:   d.createdAt,
  // B4-A — memory shows BOTH provenance facts. A timeline that said only
  // "Executed" could not tell an operator whether they had done it or Lumi had.
  humanExecutedAt:    d.humanExecutedAt    ?? null,
  platformExecutedAt: d.platformExecutedAt ?? null,
  // DEPRECATED COMPATIBILITY FIELD — derivation: platformExecutedAt ?? humanExecutedAt
  //
  // Computed by `legacyExecutedAt`, the one place that derivation lives. It is
  // NOT the stored `Decision.executedAt` column: nothing reads or writes that
  // column any more, and this value never touches it.
  //
  // THE THREE SURFACES CARRYING THIS FIELD DO NOT ALL MEAN THE SAME THING, and
  // that is deliberate rather than an inconsistency to be smoothed over:
  //
  //   here + GET /lumi/decisions/:id/executions   platformExecutedAt ?? humanExecutedAt
  //   PATCH /lumi/decisions/:id/execute           the human instant that request wrote
  //
  // The self-report route can only ever record a human execution, so returning
  // the union there would answer a question the caller did not ask — it would
  // hand back Lumi's timestamp in the response to "I did this myself". Reading
  // the same field name across endpoints and assuming one canonical fact is
  // therefore wrong about at least one of them; `humanExecutedAt` and
  // `platformExecutedAt` above are stated separately so no reader has to.
  executedAt:  legacyExecutedAt(d),

  dismissedAt: d.dismissedAt ?? null,
  // The engine's OWN per-decision outcome, written by computeResolution when a
  // later verdict superseded this one. IMPROVED | UNCHANGED | WORSENED |
  // UNKNOWN — never "success", which is a different claim the accuracy engine
  // makes over a POPULATION with an outcome snapshot behind it. null here means
  // no outcome was ever recorded, which is its own honest answer.
  resolution:      d.resolution ?? null,
  confidenceDelta: d.confidenceDelta ?? null,
});

/**
 * Past connector decisions per campaign, most recent first.
 *
 * TWO QUERIES, on purpose. `count` is a real total from a groupBy, while
 * `items` is the bounded recent slice — so "Seen 9 times" can be true while
 * only five rows are listed. Deriving the count from the truncated list instead
 * would under-report every campaign with a long history, which is the quiet
 * kind of wrong this surface exists to avoid.
 *
 * @param {string} workspaceId
 * @param {string[]} entityIds — campaign entity ids from the live feed
 * @returns {Promise<Map<string, {count:number, items:object[]}>>}
 *   Entities with no history are ABSENT from the map, not present with zero:
 *   the caller turns absence into an honest empty state, and a fabricated zero
 *   would be indistinguishable from a real one.
 */
export async function getDecisionHistory(workspaceId, entityIds = []) {
  if (!workspaceId || !Array.isArray(entityIds) || entityIds.length === 0) return new Map();

  const where = {
    workspaceId,
    entityId:    { in: entityIds },
    entityLevel: 'CAMPAIGN',
    ...connectorDecisionScope(),
  };

  try {
    const [counts, rows] = await Promise.all([
      prisma.decision.groupBy({ by: ['entityId'], where, _count: { _all: true } }),
      prisma.decision.findMany({
        where,
        select: {
          id: true, entityId: true, verdict: true, status: true, createdAt: true,
          ...PROVENANCE_SELECT, dismissedAt: true, resolution: true, confidenceDelta: true,
        },
        orderBy: { createdAt: 'desc' },
        // Bounded by the feed, not by a magic number. Ordering is global, so a
        // campaign whose whole history predates every other campaign's could be
        // crowded out of `items` — it keeps its true `count` either way, and the
        // timeline degrades to a number rather than to a wrong one.
        take: entityIds.length * HISTORY_LIMIT,
      }),
    ]);

    const totals = new Map(counts.map((c) => [c.entityId, c._count._all]));
    const map = new Map();
    for (const d of rows) {
      const bucket = map.get(d.entityId) ?? { count: totals.get(d.entityId) ?? 0, items: [] };
      // Service-side slice, so the renderer never has to decide what to hide.
      if (bucket.items.length < HISTORY_LIMIT) bucket.items.push(stated(d));
      map.set(d.entityId, bucket);
    }
    return map;
  } catch (err) {
    // History is context, not the call. Losing it must not take the verdict feed
    // with it — the panel simply shows no memory section.
    logger.debug({ err: err.message, workspaceId }, '[decisionHistory] read failed');
    return new Map();
  }
}
