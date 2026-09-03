// ============================================================
// gatingReasonInventory — who is allowed to say why a verdict is missing (C-07)
// ============================================================
// 🔒 C-07's ratchet, and it is deliberately a DIFFERENT ratchet from C-06's.
//
// C-06 guards a declared jurisdiction of status VOCABULARIES: any
// `NAME_(STATUS|STATE|REASON|RUN) = Object.freeze` under src/ or packages/ must
// have been ruled on, in writing, as DECLARED or EXCLUDED. GATING_REASON falls
// inside that jurisdiction by its suffix and is ruled EXCLUDED there — because a
// reason refines an absence the token has already classified, and declaring the
// same values in both registries would let one claim carry two knowledge tokens.
//
// This file is the other registry. It guards a jurisdiction of PRODUCERS: the
// modules allowed to put a row into `gatedOut`.
//
// ── WHY PRODUCERS, AND NOT A REGEX OVER `reason:` ───────────────────────────
// `reason:` is not a reserved word in this repository and must not be treated as
// one. metricWindow.js uses it for ROW REJECTION — SOURCE_NOT_CANONICAL,
// MISSING_ROW, CROSS_WINDOW — which is a claim about one snapshot's fitness, not
// about why a campaign has no verdict. A scan that failed on those would be
// asserting a semantic it cannot measure, which is the trap C-06 named: the
// SHAPE is measurable, the MEMBERSHIP is a written ruling.
//
// So the jurisdiction is named here, by hand, and the ratchet enforces two
// things over it:
//   1. inside a declared producer, every `reason:` site emits a GATING_REASON
//      member — never a string literal, which is how one of the three shipped
//      for years as display text on a domain wire;
//   2. no file outside the list pushes into `gatedOut` — a fourth gate has to
//      be ruled on before it can reach an operator.
//
// The producer list is a VISIBILITY rule. The declaration in
// packages/runtime-contracts/src/gatingReason.js — reason → knowledge token →
// prerequisite — is the definition.
// ============================================================

/**
 * The modules that produce `gatedOut` rows, repo-relative and POSIX-separated.
 *
 * `canonicalVerdictEvidence.js` produces two of the three (absence and
 * staleness, as `absent` / `stale`); `connectorVerdictService.js` produces the
 * third and is the single boundary where all three become one published list.
 */
export const GATING_PRODUCERS = Object.freeze([
  'src/services/verdict-engine/connectorVerdictService.js',
  'src/services/verdict-engine/canonicalVerdictEvidence.js',
]);

/**
 * A `reason:` site in a producer: the property and whatever it is assigned,
 * up to the next comma, closing brace or newline. Comments are stripped before
 * this runs — prose carries the word too.
 */
export const REASON_SITE_RE = /\breason:\s*([^,\n}]+)/g;
