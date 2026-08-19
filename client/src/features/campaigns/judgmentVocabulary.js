// ============================================================
// MARCOM / Lumi — judgment vocabulary (R13-b)
// ------------------------------------------------------------
// The words the operator picks from, and nothing else. No request, no state,
// no rendering — so the one thing that must never drift lives in one place.
//
// ── WHY THE CODES ARE RE-DECLARED HERE ──────────────────────────────────────
// The canonical list is `HUMAN_REASONS` in src/services/decision-memory/
// humanJudgment.js, which imports Prisma. Importing it into the browser bundle
// to avoid re-typing nine strings would pull a database client into the client.
// So they are re-declared, and a test reads the backend file and asserts the
// two lists are identical — the guard is a test, not an import.
//
// STORED VALUE ≠ LABEL. The `code` is what the enum column holds and is never
// renamed, translated or abbreviated; `label` is what a marketer reads. A UI
// that sent its own label would write a value the enum rejects, and a UI that
// showed the raw code would ask a buyer to classify their own reasoning in
// SCREAMING_SNAKE_CASE.
// ============================================================

/** The three answers. Stored verbatim in Decision.humanResponse. */
export const HUMAN_RESPONSE = Object.freeze({
  CONFIRM:  'CONFIRM',
  OVERRIDE: 'OVERRIDE',
  ADJUST:   'ADJUST',
});

/**
 * What each answer MEANS — and, as importantly, what it does not.
 *
 * None of the three executes anything. CONFIRM is "I agree with this call",
 * not "do it"; OVERRIDE is "I disagree", not "do the opposite". Execution is
 * the separate claim DecisionLifecycle collects, and conflating them would let
 * an agreement be read as an action nobody took.
 */
export const RESPONSE_LABEL = Object.freeze({
  CONFIRM:  'Confirm',
  OVERRIDE: 'Override',
  ADJUST:   'Adjust',
});

/**
 * Disagreeing without saying why records that something was wrong without
 * recording what. Mirrors the server's REASON_REQUIRED exactly — the server
 * refuses these with 400 ReasonRequired, and asking here first means the
 * operator learns it from the form rather than from an error.
 */
export const REASON_REQUIRED = Object.freeze(['OVERRIDE', 'ADJUST']);

/**
 * The nine canonical reasons.
 *
 * Every one of them is a piece of BUSINESS CONTEXT the verdict engine cannot
 * see: it reads spend, revenue, reach and frequency, and it does not know that
 * a campaign is deliberately top-of-funnel, or that the account is inside a
 * seasonal push. That is the whole point of collecting them — the distribution
 * is the evidence for which context is worth modelling next.
 */
export const JUDGMENT_REASONS = Object.freeze([
  { code: 'TOF_ROLE',            label: 'Top-of-funnel role' },
  { code: 'BRAND_ROLE',          label: 'Brand role' },
  { code: 'OBJECTIVE_CONTEXT',   label: 'Different objective' },
  { code: 'BUSINESS_CONSTRAINT', label: 'Business constraint' },
  { code: 'SEASONALITY',         label: 'Seasonality' },
  { code: 'TESTING_INTENT',      label: 'Deliberate test' },
  { code: 'DATA_CONTEXT',        label: 'Data is misleading' },
  { code: 'RISK_TOLERANCE',      label: 'Risk tolerance' },
  { code: 'OTHER',               label: 'Other' },
]);

/** The server's cap, restated rather than re-chosen. */
export const MAX_NOTE_LENGTH = 2000;

/** PURE. Does this answer require a structured reason? */
export const needsReason = (response) => REASON_REQUIRED.includes(response);

/**
 * PURE: the readable label for a stored code.
 *
 * Falls back to the code itself, never to 'Other' — a reason we cannot name is
 * not the OTHER bucket, and quietly relabelling it would make an unrecognised
 * value indistinguishable from a real one.
 */
export const reasonLabel = (code) =>
  JUDGMENT_REASONS.find((r) => r.code === code)?.label ?? code ?? null;
