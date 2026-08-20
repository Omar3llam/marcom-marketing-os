// ============================================================
// R13-D / B4-A — who acted, and on what evidence (PURE)
// ============================================================
// Every question about "was this decision acted on" now names its evidence
// source through this module. That is the whole point of the split: the
// question "what kind of execution does this timestamp mean?" must not exist
// anywhere in the backend, and the way to retire a question is to make each
// caller answer it once, out loud, at a named seam.
//
// THE TWO FACTS, AND WHY THEY ARE NOT ONE
//
//   humanExecutedAt     an operator told us they acted themselves. It is a
//                       CLAIM. Nothing verified it, no platform confirmed it,
//                       and Lumi did not perform it.
//
//   platformExecutedAt  the canonical worker reached EXECUTED_SUCCESS on a real
//                       ExecutionRequest. Meta accepted a mutation. This is the
//                       ONLY evidence that Lumi executed anything.
//
// They are independent. Both may be set — an operator can act by hand and later
// run the same call through Lumi, or the reverse — so neither write clears the
// other, and neither implies the other.
//
// THE THIRD QUESTION, WHICH IS A UNION AND MUST SAY SO
//
// Most consumers are not asking either of the above. The Proof Engine, the
// outcome window and the Pattern Engine ask "did an intervention happen at
// all", because their subject is whether LUMI'S RECOMMENDATION was right — not
// who carried it out. A KILL executed by hand tests the KILL exactly as well as
// one executed by the worker.
//
// That union is legitimate, and it is the reason this split did NOT repoint
// those consumers to platform evidence. Doing so would have emptied the
// accuracy population outright — production holds zero execution requests, so
// every scored decision there was human-executed — and an emptier population
// would have read as "accuracy improved" rather than "we stopped counting".
// The union is expressed here, once, with a name that says it is a union.
// ============================================================

/** PURE: the operator's self-report instant, or null. A claim, never proof. */
export const humanExecutedAt = (d) => d?.humanExecutedAt ?? null;

/** PURE: the platform-confirmed instant, or null. The only execution proof. */
export const platformExecutedAt = (d) => d?.platformExecutedAt ?? null;

/** PURE: did an operator claim they acted? Not evidence Lumi did anything. */
export const wasSelfReported = (d) => humanExecutedAt(d) != null;

/**
 * PURE: did LUMI execute this on the platform?
 *
 * The only predicate that may back a claim about Lumi's execution performance.
 * A self-report must never satisfy it.
 */
export const wasPlatformExecuted = (d) => platformExecutedAt(d) != null;

/**
 * PURE: when an intervention first occurred, by either route — or null.
 *
 * EARLIEST of the two, because the subject is the entity: the outcome window
 * opens when the campaign first changed, not when the later of two records was
 * written. With only one set (the normal case) this simply returns it.
 */
export function interventionAt(d) {
  const human = humanExecutedAt(d);
  const platform = platformExecutedAt(d);
  if (human == null) return platform;
  if (platform == null) return human;
  return new Date(human) <= new Date(platform) ? human : platform;
}

/** PURE: was this decision acted on at all, by either route? */
export const wasActedOn = (d) => interventionAt(d) != null;

/**
 * PURE: the legacy `executedAt` field for responses already shipped to clients.
 *
 * DERIVED, never the stored column — that column is deprecated and nothing
 * reads it. Platform evidence wins when both exist, because a client showing
 * one timestamp beside the word "executed" should be shown the stronger fact.
 *
 * This exists only so a frozen client keeps working across the split. New
 * readers take the two fields above; this one is scheduled for removal and
 * every route that emits it says so.
 */
export const legacyExecutedAt = (d) => platformExecutedAt(d) ?? humanExecutedAt(d);

/**
 * PURE: the provenance of an intervention, as a value a reader can branch on
 * without comparing timestamps or guessing.
 *
 * NONE is a real answer — it is what an un-acted decision honestly reports, and
 * it is not the same as "we did not look".
 */
export const EXECUTION_PROVENANCE = Object.freeze({
  NONE:     'NONE',      // nobody acted
  HUMAN:    'HUMAN',     // operator self-report only
  PLATFORM: 'PLATFORM',  // Lumi executed it
  BOTH:     'BOTH',      // both records exist; they do not contradict
});

export function provenanceOf(d) {
  const human = wasSelfReported(d);
  const platform = wasPlatformExecuted(d);
  if (human && platform) return EXECUTION_PROVENANCE.BOTH;
  if (platform) return EXECUTION_PROVENANCE.PLATFORM;
  if (human) return EXECUTION_PROVENANCE.HUMAN;
  return EXECUTION_PROVENANCE.NONE;
}

/**
 * The columns any consumer of the above must select.
 *
 * Named because an UNSELECTED Prisma column is `undefined`, which every
 * predicate here reads as "not acted on" — silently shrinking a population
 * rather than failing. Spreading this into a `select` makes the omission
 * impossible instead of merely unlikely.
 */
export const PROVENANCE_SELECT = Object.freeze({
  humanExecutedAt:    true,
  platformExecutedAt: true,
});

/**
 * The Prisma WHERE fragment for "somebody intervened" — the query-side twin of
 * `wasActedOn`, for populations that must be narrowed by the DATABASE rather
 * than filtered in memory after the fact.
 *
 * WHY IT LIVES HERE AND NOT IN THE CONSUMER
 *   The union is one definition of one fact, and provenance is the thing most
 *   likely to get stricter. A consumer that spells the OR out inline is a copy
 *   that will not be found when the definition moves, and the failure mode is
 *   silent: the stale copy keeps returning rows, just a different set from
 *   everyone else's. C1 adds the first consumer of this constant.
 *
 * SPREAD IT, DO NOT NEST IT: `{ workspaceId, ...INTERVENED_WHERE }`. It owns
 * the `OR` key outright, so a where clause that already carries its own `OR`
 * must combine them under `AND` instead of spreading, or one will silently win.
 *
 * NOT YET THE ONLY COPY. `DecisionAccuracyService.ACTIONED` and
 * `PatternService`'s population filter still spell the same union out inline.
 * Repointing them is a behaviour-free substitution and is deliberately NOT part
 * of C1 — that slice's scope forbids touching either engine. Named here so the
 * consolidation is findable rather than merely intended.
 */
export const INTERVENED_WHERE = Object.freeze({
  OR: Object.freeze([
    Object.freeze({ humanExecutedAt:    { not: null } }),
    Object.freeze({ platformExecutedAt: { not: null } }),
  ]),
});

