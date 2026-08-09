// ============================================================
// MARCOM / Lumi — Decision identity: which rows are CONNECTOR verdicts
// ------------------------------------------------------------
// The Decision table is shared. FIVE writers put PROPOSED rows in it, and four
// of them are not the connector verdict engine:
//
//   VerdictService          rootCause = a SIGNAL_TYPE / ROOT_CAUSE /
//                           FUNNEL_SIGNAL, or null   ← the connector verdicts
//   GuardrailSweepService   rootCause = `guardrail:<rule>`
//   AllocationService       rootCause = `allocation:<planId>`
//   IncrementalityService   rootCause = `incrementality:<testId>`
//   TestGeneratorService    rootCause = `test:<...>`
//
// Three of those four write at CAMPAIGN level against a real campaign entityId,
// so `entityLevel: 'CAMPAIGN' AND status: 'PROPOSED'` does NOT identify a
// connector verdict — it identifies "some campaign-level proposal", which is a
// different and much larger set.
//
// Every non-connector writer uses a NON-NULL PREFIXED cause. So this set plus
// null identifies connector verdicts exactly, and that equivalence is the whole
// reason the taxonomy is worth having.
//
// ── Why this lives in its own module ────────────────────────────────────────
// It was a private const in VerdictService, which imports buildConnectorVerdictTree
// FROM connectorVerdictService. Exporting it from there and importing it back
// would close an import cycle over a top-level `const` — a TDZ ReferenceError at
// module load, which every test would pass straight through and the server would
// die on. A leaf module both sides import has no such edge.
// ============================================================
import { SIGNAL_TYPE }  from '../diagnosis-engine/index.js';
import { ROOT_CAUSE }   from './verdictTypes.js';
import { FUNNEL_SIGNAL } from './funnelDiagnosis.js';

/**
 * Every rootCause the connector verdict engine can emit.
 *
 * LOAD-BEARING, twice over:
 *   supersedeDroppedConnectorVerdicts scopes on it — a cause missing from here
 *     makes its verdicts un-supersedable, and they pile up as permanently-open
 *     PROPOSED rows.
 *   getLatestDecisions scopes on it — a cause missing from here makes its
 *     verdict invisible to the identity projection, so the surface silently
 *     falls back to by-entity routing.
 * Any cause the engine can emit MUST be listed.
 */
export const CONNECTOR_ROOT_CAUSES = Object.freeze([
  ...Object.values(SIGNAL_TYPE),
  ...Object.values(ROOT_CAUSE),
  ...Object.values(FUNNEL_SIGNAL),
]);

/**
 * Which connector-authored findings belong in the Agentic Loop's buyer band.
 *
 * THIS IS AN ACTIONABILITY SCOPE, NOT AN IDENTITY ONE. The two answer different
 * questions and must not be swapped:
 *
 *   CONNECTOR_ROOT_CAUSES        → who AUTHORED this Decision?
 *   BUYER_ACTIONABLE_ROOT_CAUSES → may that authored finding enter the buyer
 *                                  confirmation band?
 *
 * Data-quality causes are deliberately excluded. INSUFFICIENT_DATA and TOO_EARLY
 * mean "not judged yet", which is not a decision anyone can confirm — and both
 * are emitted as WATCH, which agenticPlanner ranks HIGH, so admitting them would
 * put the engine's own blind spots at the TOP of the buyer's agenda.
 *
 * Derived by SUBTRACTION rather than by re-listing the two wanted families. The
 * bug this replaced was a local `Object.values(SIGNAL_TYPE)` that silently went
 * stale when FUNNEL_SIGNAL joined the taxonomy: an additive list excludes any
 * future family by default and says nothing. Subtracting the one family that is
 * knowably NOT a decision keeps new causes visible, and the exact-membership
 * test pins the result so a fourth family cannot slip in unexamined either way.
 *
 * Keep aligned with isDataQualityCause() in client/src/features/campaigns/verdictEvidence.js.
 */
const DATA_QUALITY_ROOT_CAUSES = new Set(Object.values(ROOT_CAUSE));

export const BUYER_ACTIONABLE_ROOT_CAUSES = Object.freeze(
  CONNECTOR_ROOT_CAUSES.filter((cause) => !DATA_QUALITY_ROOT_CAUSES.has(cause)),
);

/**
 * The Prisma `where` fragment selecting connector-authored decisions.
 *
 * `rootCause: null` is IN the set, not an oversight: the engine leaves it null
 * on verdicts it reached without a diagnosis (the early gates especially), and
 * excluding it would drop exactly the campaigns that never got one.
 *
 * Returned as a fresh object each call — Prisma mutates nothing, but a frozen
 * shared literal spread into two different `where` clauses invites someone to
 * add a key to one and change both.
 */
export function connectorDecisionScope() {
  return { OR: [{ rootCause: { in: CONNECTOR_ROOT_CAUSES } }, { rootCause: null }] };
}
