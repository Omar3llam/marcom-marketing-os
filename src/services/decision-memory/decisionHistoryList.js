// ============================================================
// THE THEN DESTINATION — the workspace's decision history (B8-03)
// ------------------------------------------------------------
// B7 R-N2 gave the Decision its own addressable list. This is that list's read,
// and it is deliberately NOT `getRecentDecisions`:
//
//     getRecentDecisions      "the last few calls, for the sidebar strip"
//                             SIGNAL-only · take 20 · no cursor · no total
//                             · no decisionClass in the projection
//
//     getDecisionHistoryPage  "what has this workspace decided, all of it"
//                             SIGNAL + GUARDRAIL · cursor · total · class
//
// Growing the first into the second would bind a destination to a sidebar's
// question. C-12 is the record of what that costs.
//
// ── WHY THE ORDER NEEDS A TIEBREAK, AND WHY THE CURSOR IS KEYSET ────────────
// A sweep writes several rows in ONE transaction, so `createdAt` ties routinely
// — that is the normal case, not an edge one. An ordering that is not TOTAL
// makes a cursor skip rows or repeat them, and the operator sees a decision
// twice or never. `[createdAt desc, id desc]` is total, and the cursor carries
// BOTH values so the next page resumes exactly where the last one ended.
//
// ── WHY `total` IS COUNTED, NOT INFERRED ────────────────────────────────────
// B8-01's forbidden inference: a capped list is not a capped count. The page
// says how many rows it carries; only a COUNT over the same predicate can say
// how many exist. Publishing the page length as a total would tell an operator
// their account has 20 decisions because 20 is what we asked for.
//
// PURE-ish: one read, one count, no clock. A stored decision is never re-dated.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';

/** Rows per page. Not the sidebar's cap — a destination pages, a strip does not. */
export const HISTORY_PAGE_SIZE = 25;

/**
 * Exactly what a THEN row states, and nothing more.
 *
 * A select-less read would widen silently on every new column (see the
 * default-projection trap), so the destination declares what it renders.
 * `hypotheses` / `counterfactuals` are deliberately absent: they belong to the
 * DETAIL surface, which publishes them through `committedFields` with a
 * per-field knowledge token. A list that carried them would invite a row to
 * summarise reasoning it cannot qualify.
 */
export const HISTORY_PAGE_SELECT = Object.freeze({
  id: true,
  // B8-02's row has a class-filled slot — the class explains on what grounds to
  // believe the call. RECENT_DECISION_SELECT omits this, which is precisely why
  // that read cannot serve this surface.
  decisionClass: true,
  entityId: true,
  entityLevel: true,
  verdict: true,
  status: true,
  diagnosis: true,
  rootCause: true,
  confidence: true,
  createdAt: true,
});

/** PURE: encode a keyset cursor. Opaque to the client by construction. */
export function encodeCursor(row) {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/**
 * PURE: decode a keyset cursor, or null if it is not one.
 *
 * A malformed cursor returns null rather than throwing: it means "start from
 * the beginning", which is a recoverable answer. Throwing would turn a stale
 * bookmark into a broken destination.
 */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * One page of the workspace's decision history, newest first.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {number} [args.limit]   rows in this page
 * @param {string} [args.cursor]  opaque keyset cursor from a previous page
 * @returns {Promise<{decisions: object[], total: number, nextCursor: string|null}>}
 */
export async function getDecisionHistoryPage({ workspaceId, limit = HISTORY_PAGE_SIZE, cursor = null } = {}) {
  if (!workspaceId) return { decisions: [], total: 0, nextCursor: null };

  const take = Math.max(1, Math.min(Number(limit) || HISTORY_PAGE_SIZE, 100));
  const jurisdiction = { workspaceId, ...scopeFor('decisions/history') };

  // The keyset predicate. In DESC order the next page is everything strictly
  // "after" the cursor row: an older instant, OR the same instant with a lower
  // id. The second clause is what makes a tie survivable.
  const after = decodeCursor(cursor);
  const where = after
    ? {
      ...jurisdiction,
      OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ],
    }
    : jurisdiction;

  const [rows, total] = await Promise.all([
    prisma.decision.findMany({
      where,
      select:  HISTORY_PAGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row, so "is there another page" is OBSERVED rather than
      // inferred from a full page — a full last page would otherwise publish a
      // cursor that leads nowhere.
      take: take + 1,
    }),
    // Counted over the JURISDICTION, never over the page's `where`: the total
    // is how many decisions exist, not how many remain after this cursor.
    //
    // The scope is spread INLINE rather than passed as `jurisdiction`, so this
    // call declares the classes it accepts in its own body — T13's guard reads
    // the call, and a count that says nothing about its classes is exactly the
    // blind read C-10 exists to end. `scopeFor` is the single source either
    // way, so the two predicates cannot drift.
    prisma.decision.count({ where: { workspaceId, ...scopeFor('decisions/history') } }),
  ]);

  const hasMore = rows.length > take;
  const decisions = hasMore ? rows.slice(0, take) : rows;

  return {
    decisions,
    total,
    nextCursor: hasMore ? encodeCursor(decisions[decisions.length - 1]) : null,
  };
}
