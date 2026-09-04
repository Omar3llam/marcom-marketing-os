// ============================================================
// The ONE classifier — rootCause → decisionClass (C-10)
// ============================================================
// 🔒 C-10, and deliberately the only one. Before this, three modules derived a
// class from a `rootCause` string independently:
//
//   NarrativeService        /^allocation:([0-9a-f-]+)/i
//   feed.js                 startsWith: 'guardrail:'
//   guardrailHitIdentity    startsWith: 'guardrail:'   (the pre-C-02 fallback)
//
// Three parsers, three chances to disagree, and no test that they did not.
//
// ── THIS IS A TRANSITIONAL BOUNDARY, NOT AN API ─────────────────────────────
//
// It exists to fill `Decision.decisionClass` for rows written before the column,
// and to be compared against the SQL that does the same job in the migration.
// Steady state:
//
//     Consumers query decisionClass. They do not infer it from rootCause.
//
// A new call site is a defect unless it is the backfill or its verification.
//
// ── WHY IT IS NOT IN @marcom/runtime-contracts BESIDE THE REGISTRY ──────────
//
// Because it needs a FACT the package does not have: which causes the connector
// engine can emit. In the package it could only recognise a connector cause by
// SHAPE — upper-snake, no prefix — and that cannot tell a live enum member from
// one deleted a year ago. Both would answer SIGNAL, which is exactly the
// invention this module refuses.
// ============================================================
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { CONNECTOR_ROOT_CAUSES } from '../verdict-engine/decisionIdentity.js';

/**
 * How each non-connector class encoded itself before it had a name.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL: `test:` must be tested before nothing
 * else here starts with it, which is true today and is pinned by the tests.
 * Kept as a list rather than an object so the order is visible.
 */
export const CLASS_PREFIXES = Object.freeze([
  Object.freeze(['guardrail:',      DECISION_CLASS.GUARDRAIL]),
  Object.freeze(['allocation:',     DECISION_CLASS.ALLOCATION]),
  Object.freeze(['test:',           DECISION_CLASS.EXPERIMENT]),
  Object.freeze(['incrementality:', DECISION_CLASS.EXPERIMENT]),
]);

const CONNECTOR = new Set(CONNECTOR_ROOT_CAUSES);

/**
 * Classify one stored `rootCause`.
 *
 * NULL IS AN ANSWER, NOT A FALLBACK. A row whose cause names an enum value
 * since deleted from the code is genuinely unclassifiable, and saying so is the
 * only honest response — the same ruling as C-02's legacy hits and C-05's
 * legacy rules: a migration must never pretend to know.
 *
 * The trap this refuses is a `?? SIGNAL` tail. It would look harmless and would
 * enrol every unrecognised row into the accuracy surface, the learning
 * population and the budget appetite gate in one line.
 *
 * @param {string|null|undefined} rootCause
 * @returns {string|null} a DECISION_CLASS member, or null when unclassifiable
 */
export function classifyRootCause(rootCause) {
  // `null` is a SIGNAL, not an unknown. The engine leaves the cause null on
  // verdicts it reached without a diagnosis — the early gates especially — and
  // treating that as unclassifiable would strand exactly the campaigns that
  // never got one, which is the population `connectorDecisionScope` was built
  // to keep. It is the one case where absence is itself the evidence.
  if (rootCause === null) return DECISION_CLASS.SIGNAL;
  if (typeof rootCause !== 'string' || rootCause === '') return null;

  for (const [prefix, cls] of CLASS_PREFIXES) {
    if (rootCause.startsWith(prefix)) return cls;
  }
  return CONNECTOR.has(rootCause) ? DECISION_CLASS.SIGNAL : null;
}
