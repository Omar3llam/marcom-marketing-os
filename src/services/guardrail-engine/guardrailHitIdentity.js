// ============================================================
// MARCOM / Lumi — Guardrail hit identity (C-02)
// ------------------------------------------------------------
// What makes two guardrail breaches THE SAME breach.
//
// A hit is an EPISODE: the pair (rule, entity) for as long as the breach is
// continuously observed. It opens when a sweep that EVALUATED the pair finds a
// breach and none is open; it closes when a sweep that EVALUATED the pair finds
// none. A later breach on the same pair is a NEW episode, not a revival.
//
// ── WHY THIS IS NOT `rootCause` ─────────────────────────────────────────────
// The sweep writes `guardrail:<rule.name>`. A rule name is mutable and is not
// unique, so it identifies nothing — renaming a rule silently re-labels its
// entire history, and two rules may share a name. The stable half of the key was
// always available: evaluateGuardrails returns `hit.ruleId`, a real uuid, which
// the writer discarded in favour of the display string.
//
// ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
// Same reason decisionIdentity.js is: the writer (GuardrailSweepService) and the
// readers that will consume this key sit on opposite sides of imports that
// already cross. A leaf module both sides import has no cycle to close.
//
// ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
// There is no parser for legacy rows. Decisions written before this column
// existed carry a mutable name and no ruleId, and resolving that name to a rule
// as it stands today would attribute hits to a rule that may have been renamed
// since, or to whichever of two same-named rules was found first. That is
// inventing an identity for rows that never had one. They are identifiable AS
// legacy (below) and nothing more is claimed about them.
// ============================================================

/**
 * The open-episode key, or null when the pair cannot be identified.
 *
 * Null is returned rather than a fabricated key when `ruleId` is missing. A rule
 * loaded from the database always has one, so this is unreachable from the
 * production path — but the engine types `ruleId` as nullable, and a key built
 * from a null would collapse every unidentifiable pair onto a single value that
 * the unique index would then treat as one episode.
 *
 * @param {{ ruleId?: string|null, entityId?: string|null, entityLevel?: string|null }} pair
 * @returns {string|null}
 */
export function openHitKey({ ruleId, entityId, entityLevel } = {}) {
  if (!ruleId || !entityId || !entityLevel) return null;
  return `${ruleId}:${entityId}:${entityLevel}`;
}

/**
 * The Prisma `where` fragment selecting guardrail Decisions that carry an
 * identity — i.e. everything this module can reason about.
 *
 * Stronger than matching `rootCause` on a `guardrail:` prefix, which is what
 * every current consumer does: a prefix match depends on a display string that a
 * rename can move out from under it.
 */
export function identifiedGuardrailScope() {
  return { guardrailRuleId: { not: null } };
}

/**
 * The Prisma `where` fragment selecting guardrail Decisions written before this
 * identity existed.
 *
 * Exported so the set is nameable rather than merely implied. Nothing in the
 * system closes, deduplicates or counts these as open episodes; naming them is
 * how that stays a decision instead of an oversight.
 */
export function legacyGuardrailScope() {
  return { guardrailRuleId: null, rootCause: { startsWith: 'guardrail:' } };
}
