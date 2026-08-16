// ============================================================
// outcomeSelection — which OutcomeSnapshot is the CURRENT one
// ============================================================
// R6 (I19). Before this, "the current outcome" was not a question anyone had to
// ask: the writer updated the newest row in place, so there was one row per
// decision and every reader took it. Recording now APPENDS — the previous
// result keeps its values, its provenance and its measuredAt — so the readers
// need a definition, and it has to live in exactly one place.
//
// THE DEFINITION
//   current = the latest OutcomeSnapshot with `supersededAt IS NULL`.
//
// Two conditions, and the second one is not redundant. Ordering alone would
// still be correct for every chain this writer produces (the new row is always
// the newest), but it would be correct BY ACCIDENT: a repair script, a restored
// row or a second writer that inserted out of order would silently promote a
// retired result. The predicate says what is true; the ordering resolves the tie
// a partial write could leave behind.
//
// WHY NOT ONE getCurrentOutcome() FOR EVERYONE
//   The readers do not share a query shape — accuracy pulls the outcome as a
//   nested relation on a decision findMany, patterns pull many decisions' rows
//   flat. A single function would force one of them into an N+1 to use it. So
//   the PREDICATE is shared and the query stays the caller's; getCurrentOutcome
//   exists for the one-decision case that genuinely wants a row back.
// ============================================================
import { prisma } from '../../lib/prisma.js';

/**
 * The current-outcome predicate. Spread into a `where`, never mutated.
 *
 * `supersededAt: null` is a real Prisma predicate (IS NULL), which is exactly
 * what is wanted here — unlike the seam options in operationalEvidence, where a
 * null means "the caller did not ask" and must be omitted entirely.
 */
export const CURRENT_OUTCOME_WHERE = Object.freeze({ supersededAt: null });

/** Newest first — the tie-break above, not the definition. */
export const CURRENT_OUTCOME_ORDER_BY = Object.freeze({ createdAt: 'desc' });

/**
 * The current outcome of ONE decision, or null.
 *
 * Workspace-scoped like every other read on this table: a decisionId from
 * another workspace resolves to null rather than to somebody else's result.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {string} decisionId
 * @param {{ select?: object }} [opts] — REQUIRED in spirit: pass the projection
 *   you read. An unprojected read widens on every new column (#209).
 * @returns {Promise<object|null>}
 */
export async function getCurrentOutcome(workspaceId, decisionId, { select } = {}) {
  if (!workspaceId) throw new Error('getCurrentOutcome: workspaceId required');
  if (!decisionId) throw new Error('getCurrentOutcome: decisionId required');
  if (!select) throw new Error('getCurrentOutcome: select required (an unprojected read widens silently)');

  return prisma.outcomeSnapshot.findFirst({
    where: { workspaceId, decisionId, ...CURRENT_OUTCOME_WHERE },
    orderBy: CURRENT_OUTCOME_ORDER_BY,
    select,
  });
}
