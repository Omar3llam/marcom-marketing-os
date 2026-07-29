// ============================================================
// decisionLearning — what happened the last N times we said this
// ============================================================
// Seeds the future "9 of 12 similar decisions improved" line. No UI reads this
// yet; it ships now so the shape is settled before anything renders it.
//
// ── What it counts, and what it refuses to ───────────────────────────────────
// Only decisions that are BOTH resolved (we know what happened next) AND acted
// on (intentAt set — a human took it somewhere they could act). A verdict that
// sat in a list and was replaced two weeks later tells you nothing about whether
// acting on this kind of verdict works; counting it would quietly turn "acting
// on this helped" into "this campaign drifted", which is a different claim.
//
// The counts are CORRELATIONAL and the shape says so: `improved` is "improved
// after", never "improved because". Whoever renders this must not upgrade it to
// causation in the copy.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

// How many past decisions of a kind to look back over. Recent behaviour is the
// relevant behaviour — an account that changed strategy six months ago should
// not be judged on what happened before it did.
const DEFAULT_LIMIT = 20;

const EMPTY = Object.freeze({ total: 0, improved: 0, unchanged: 0, worsened: 0, unknown: 0 });

/**
 * Outcome tally for past decisions of the same verdict in this workspace.
 *
 * @param {string} workspaceId
 * @param {string} verdict — the verdict being asked about (KILL, SCALE, …)
 * @param {{limit?:number}} [opts]
 * @returns {Promise<{total:number, improved:number, unchanged:number, worsened:number, unknown:number}>}
 *   All zeros when nothing qualifies — an honest "no track record yet", which
 *   the caller must render as such rather than as 0% success.
 */
export async function getSimilarOutcomes(workspaceId, verdict, { limit = DEFAULT_LIMIT } = {}) {
  if (!workspaceId || !verdict) return { ...EMPTY };

  const rows = await prisma.decision.findMany({
    where: {
      workspaceId,
      verdict,
      resolution: { not: null }, // we know what happened next
      intentAt:   { not: null }, // …and a human actually acted on it
    },
    select:  { resolution: true },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, verdict }, '[decisionLearning] read failed');
    return [];
  });

  const tally = { ...EMPTY, total: rows.length };
  for (const r of rows) {
    if (r.resolution === 'IMPROVED') tally.improved += 1;
    else if (r.resolution === 'UNCHANGED') tally.unchanged += 1;
    else if (r.resolution === 'WORSENED') tally.worsened += 1;
    else tally.unknown += 1;
  }
  // UNKNOWN is carried, not folded into the others. A caller that wants a
  // "9 of 12" line must decide for itself whether to quote `total` or
  // `total - unknown` as the denominator — silently dropping the unscoreable
  // ones here would inflate every success rate we ever show.
  return tally;
}
