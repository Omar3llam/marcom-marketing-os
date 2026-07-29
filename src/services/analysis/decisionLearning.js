// ============================================================
// decisionLearning — what happened the last N times we said this
// ============================================================
// Backs the "9 of 12 similar decisions improved" line.
//
// ── What counts as similar ──────────────────────────────────────────────────
// verdict + rootCause + entityLevel + objective + channel. Verdict alone is too
// coarse: a KILL on a META conversion campaign and a KILL on a Google awareness
// campaign have different track records, and averaging them describes neither.
// Each key narrows only when the asking decision HAS it — a decision with no
// channel recorded compares against the wider set rather than against nothing.
//
// ── What it refuses to count ────────────────────────────────────────────────
// Only decisions that are BOTH resolved (we know what happened next) AND acted
// on (intentAt — a human took it somewhere they could act). A verdict that sat
// in a list and got replaced two weeks later says nothing about whether ACTING
// on this kind of verdict works; counting it would turn "acting on this helped"
// into "this campaign drifted".
//
// UNKNOWN rows are excluded from the denominator entirely. They are decisions
// whose outcome could not be scored, and "9 of 12" must mean twelve decisions
// that WERE scored — otherwise the sentence claims a measurement that was never
// taken. They are returned separately so a caller can say how many were dropped.
//
// The counts are CORRELATIONAL. `improved` is "improved after", never "improved
// because" — nothing here establishes that the action caused the change, and no
// copy built on it may claim otherwise.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

// How far back to look. Recent behaviour is the relevant behaviour.
const DEFAULT_LIMIT = 20;

// Below this many SCORED outcomes the sample says nothing, and a "1 of 1
// improved" line would read as a track record when it is a coincidence. Under
// the floor the function returns null and the UI renders nothing at all —
// silence is the honest state, not "0% success".
export const MIN_SAMPLE = 3;

/**
 * Outcome tally for comparable past decisions, or null when there is no
 * defensible track record to show.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.verdict
 * @param {string} [args.rootCause]   — narrows when present
 * @param {string} [args.entityLevel] — narrows when present
 * @param {string} [args.objective]   — narrows when present
 * @param {string} [args.channel]     — narrows when present
 * @param {number} [args.limit]
 * @returns {Promise<{total:number, improved:number, unchanged:number,
 *                    worsened:number, unscored:number, confidence:number}|null>}
 *   null when: no workspace/verdict, fewer than MIN_SAMPLE scored outcomes, or
 *   none of them improved. `total` counts SCORED outcomes only.
 */
export async function getSimilarOutcomes({
  workspaceId, verdict, rootCause, entityLevel, objective, channel, limit = DEFAULT_LIMIT,
} = {}) {
  if (!workspaceId || !verdict) return null;

  const rows = await prisma.decision.findMany({
    where: {
      workspaceId,
      verdict,
      // Each dimension narrows ONLY when the asking decision carries it.
      ...(rootCause   ? { rootCause }   : {}),
      ...(entityLevel ? { entityLevel } : {}),
      ...(objective   ? { objective }   : {}),
      ...(channel     ? { channel }     : {}),
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

  let improved = 0, unchanged = 0, worsened = 0, unscored = 0;
  for (const r of rows) {
    if (r.resolution === 'IMPROVED') improved += 1;
    else if (r.resolution === 'UNCHANGED') unchanged += 1;
    else if (r.resolution === 'WORSENED') worsened += 1;
    else unscored += 1; // UNKNOWN — outside the denominator, reported separately
  }

  const total = improved + unchanged + worsened;

  // Too small a sample, or nothing to claim. Both return null so the caller
  // renders NOTHING — an empty state here would invite reading "0 of 2" as
  // evidence, which is exactly what too small a sample cannot provide.
  if (total < MIN_SAMPLE || improved === 0) return null;

  return {
    total,
    improved,
    unchanged,
    worsened,
    unscored,
    confidence: improved / total, // 0–1, over SCORED outcomes only
  };
}
