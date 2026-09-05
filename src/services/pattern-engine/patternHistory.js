// ============================================================
// A belief's own history — the two facts that could not cross (C-14)
// ============================================================
// B8-05 asks for four temporal facts per belief. Measured on `fc6ceda`, TWO of
// them already cross the wire and are simply unrendered:
//
//   since when   `firstObservedAt` / `lastObservedAt`  — in BRIEFING_SELECT
//   aliveness    `support` beside `effectiveSupport`   — in BRIEFING_SELECT
//
// This module is the other two, which could not cross at all.
//
// ── A · HOW OFTEN TESTED, HOW OFTEN RIGHT ───────────────────────────────────
//
// `score()` (patternEngine.js:123) builds `known` — the observations carrying a
// measured outcome — divides the weighted correct-sum by it, returns the
// quotient, and keeps NEITHER count. `AccountPattern` has no column for either.
// So a belief reaches a person as a bare percentage:
//
//       2 of 3    →  67%
//     200 of 300  →  67%
//
// Identical figures carrying utterly different weight. C-09's shape one object
// over — computed every run, stored nowhere — and I54's argument one step on:
// I54 stopped a FABRICATED prior rendering as a percentage; a REAL ratio with
// no denominator is still a figure the reader cannot weigh.
//
// The counts are derived at READ rather than stored, and deliberately so.
// `PatternObservation` already holds the truth, append-only and idempotent
// (`@@unique([patternId, occurrenceKey])`); a persisted count would be a second
// copy of a fact that already exists, drifting the moment an observation lands
// between extractions. Reading it also gives that record its first reader —
// until now its only production touch in the entire repo was one `createMany`.
//
// ── WHY THESE COUNTS ARE NOT `accuracy`'S DENOMINATOR ───────────────────────
//
// `accuracy` is recency-WEIGHTED; these are RAW. A belief right recently and
// wrong long ago legitimately reads 0.85 beside 3 of 5, and that is not a
// contradiction — it is two facts about one belief at two altitudes. R-5's
// rule, one object down: publish both, name both, reconcile neither. It is also
// why this field is `checks` and not, say, `accuracyBasis`: a name binding them
// would assert the very derivation the contract forbids.
//
// ── B · WHAT REPLACED THIS BELIEF, AND WHICH WAY THE EDGE POINTS ────────────
//
// Measured before it was built, at patternEngine.js:392:
//
//     other.status = PATTERN_STATUS.SUPERSEDED;
//     other.supersededByKey = canonical.key;
//
// The LOSER is marked SUPERSEDED and its pointer aims at the WINNER. So
// `X.supersededById = Y` reads "Y replaced X": the edge runs FORWARD, from the
// replaced belief to its replacement. Resolving that column answers "what
// replaced this" — publishing it as "what this replaced" would be a falsehood
// no gate could catch, because the payload would be well-formed and exactly
// backwards.
//
// Forward is also the direction R-5 called available: it is a column read, per
// row, that cannot fan out. The reverse (`supersedes[]`) is a scan, one winner
// can hold many losers, and it has no ruling behind it. Not published.
//
// The pointer is resolved to the replacement's STATEMENT because an id is not
// readable: "replaced by 7f3a-…" tells a person nothing.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { KNOWLEDGE } from '@marcom/runtime-contracts';

/** A pair we could not read. NULL counts, never zero — see below. */
const UNREADABLE_CHECKS = Object.freeze({ made: null, held: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK });

/**
 * How often each belief met a measured outcome, and how often it held.
 *
 * Returns an entry for EVERY requested id, so a caller never supplies a
 * default — a default at the call site is where a default becomes a lie:
 * `?? 0` would silently turn "we could not look" into "never checked".
 *
 * @returns {Promise<Map<string, {made: number|null, held: number|null, knowledge: string}>>}
 */
export async function checksByPattern(workspaceId, patternIds = []) {
  const out = new Map();
  if (!Array.isArray(patternIds) || patternIds.length === 0) return out;

  const unreadable = () => {
    for (const id of patternIds) out.set(id, UNREADABLE_CHECKS);
    return out;
  };
  if (!workspaceId) return unreadable();

  const where = { workspaceId, patternId: { in: patternIds } };

  let made; let held;
  try {
    // C-12's lesson: a per-query `.catch()` handles a REJECTION, not a
    // synchronous throw while the promise is being constructed. That throw
    // escapes Promise.all, and here it would take the whole briefing down —
    // the memory surface, not one field on it.
    [made, held] = await Promise.all([
      // `correct` is three-valued: true, false, and NULL for an occurrence seen
      // but never scored. `not: null` is therefore "was checked at all", which
      // is a different population from `true`, and the difference IS the claim.
      prisma.patternObservation.groupBy({
        by: ['patternId'], where: { ...where, correct: { not: null } }, _count: { _all: true },
      }).catch((err) => { logger.debug({ err: err.message }, '[c14] checks(made) failed'); return null; }),
      prisma.patternObservation.groupBy({
        by: ['patternId'], where: { ...where, correct: true }, _count: { _all: true },
      }).catch((err) => { logger.debug({ err: err.message }, '[c14] checks(held) failed'); return null; }),
    ]);
  } catch (err) {
    logger.debug({ err: err.message }, '[c14] checks could not be issued');
    return unreadable();
  }

  // A partial answer is never published as a whole one: without both halves the
  // ratio-free pair we exist to publish cannot be stated at all.
  if (made === null || held === null) return unreadable();

  const madeById = new Map(made.map((r) => [r.patternId, r._count._all]));
  const heldById = new Map(held.map((r) => [r.patternId, r._count._all]));

  for (const id of patternIds) {
    const m = madeById.get(id) ?? 0;
    // ZERO IS A MEASUREMENT HERE, and only here. We looked, and this belief has
    // never met a scored outcome — a finding about the belief. The same zero
    // published after a failed read would be a finding about US, wearing the
    // belief's name. C-03's ruling, one object over.
    out.set(id, m === 0
      ? { made: 0, held: 0, knowledge: KNOWLEDGE.NOTHING_THERE }
      : { made: m, held: heldById.get(id) ?? 0, knowledge: KNOWLEDGE.KNOWN });
  }
  return out;
}

/**
 * What replaced each belief — the FORWARD edge, resolved to a statement.
 *
 * @param {Array<{id: string, supersededById: string|null}>} rows
 * @returns {Promise<Map<string, {value: {id: string, statement: string}|null, knowledge: string}>>}
 */
export async function replacementOf(workspaceId, rows = []) {
  const out = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return out;

  // One read for the whole page, deduplicated: several beliefs can have lost to
  // the same winner, and that must not become N queries.
  const pointerIds = [...new Set(rows.map((r) => r.supersededById).filter(Boolean))];

  let byId = new Map();
  if (pointerIds.length > 0) {
    if (!workspaceId) byId = null;
    else {
      try {
        const found = await prisma.accountPattern.findMany({
          where: { workspaceId, id: { in: pointerIds } },
          select: { id: true, statement: true },
        }).catch((err) => { logger.debug({ err: err.message }, '[c14] replacement resolve failed'); return null; });
        byId = found === null ? null : new Map(found.map((p) => [p.id, p.statement]));
      } catch (err) {
        logger.debug({ err: err.message }, '[c14] replacement read could not be issued');
        byId = null;
      }
    }
  }

  for (const r of rows) {
    if (!r.supersededById) {
      // The commonest case: a belief nothing has beaten. A finding, not a gap.
      out.set(r.id, { value: null, knowledge: KNOWLEDGE.NOTHING_THERE });
      continue;
    }
    const statement = byId === null ? undefined : byId.get(r.supersededById);
    // An unresolvable pointer is COULD_NOT_LOOK, never "nothing replaced it".
    // The column asserts a row exists — `onDelete: SetNull` clears the pointer
    // rather than leaving it dangling — so failing to produce that row means
    // our read did not reach it. Publishing NOTHING_THERE here would contradict
    // the belief's own record to a person's face.
    out.set(r.id, statement === undefined
      ? { value: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK }
      : { value: { id: r.supersededById, statement }, knowledge: KNOWLEDGE.KNOWN });
  }
  return out;
}
