// ============================================================
// Grammar vocabulary — declared here, held equal to the contracts
// ------------------------------------------------------------
// Decision classes and knowledge tokens come from @marcom/runtime-contracts
// (C-06, C-10), which is plain data and costs the page nothing.
//
// Verdicts and Decision statuses are DECLARED, for the same reason the state
// registry below is: reading them off the parse layer meant importing
// `decision.schema`, and with it the whole zod runtime, into every page that
// renders a VerdictMark — the public landing included. Measured at d7f3c2b:
// 55,729 B raw / 13,018 B gzip, to obtain eleven string literals.
//
// This is NOT a second verdict map (audit §15). The parse layer remains the
// only authority: `states.test.jsx` holds these arrays equal to
// `VerdictSchema.options` and `DecisionStatusSchema.options` in BOTH
// directions and in order, and asserts this file never imports the schema
// again. If the contract gains a verdict and this list does not, the suite
// fails — which is the same control STATE_CLASS has always had.
//
// THE STATE REGISTRY below mirrors semantic.json `$states` (the 17 locked
// states and their illumination class). It is declared, not imported, so the
// token source stays out of the bundle; `states.test.jsx` holds the two equal
// in both directions.
// ============================================================
import { DECISION_CLASS, KNOWLEDGE } from '@marcom/runtime-contracts';

/** Exactly `VerdictSchema.options`, in schema order. */
export const VERDICTS = Object.freeze(['KILL', 'HOLD', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH']);

/** Exactly `DecisionStatusSchema.options`, in schema order. */
export const DECISION_STATUSES = Object.freeze(['PROPOSED', 'EXECUTED', 'DISMISSED', 'SUPERSEDED', 'RESOLVED']);

export { DECISION_CLASS, KNOWLEDGE };

/**
 * The published agreement between a current assessment and a stored decision.
 * Declared here because the backend keeps VERDICT_AGREEMENT out of the shared
 * package until a client branches on it (src/services/verdict-engine/
 * decisionAgreement.js:33-38). Registered as a Phase 3 finding.
 */
export const AGREEMENT = Object.freeze({ AGREES: 'AGREES', DIVERGES: 'DIVERGES' });

/** STATE → illumination class, exactly as semantic.json `$states`. */
export const STATE_CLASS = Object.freeze({
  LOADING: 'absence',
  AVAILABLE: 'value',
  EMPTY: 'value',
  FAILED: 'claim',
  UNAVAILABLE: 'absence',
  NOT_CONNECTED: 'absence',
  NOT_PERMITTED: 'absence',
  STALE: 'value',
  PROCESSING: 'value',
  SUCCESS: 'value',
  NOT_MEASURED: 'absence',
  INSUFFICIENT_DATA: 'absence',
  NO_CONVERSIONS: 'absence',
  MIXED_CURRENCY: 'absence',
  NOT_SUPPORTED: 'absence',
  DISABLED: 'interaction',
  PARTIAL: 'value',
});

export const STATES = Object.freeze(Object.keys(STATE_CLASS));

/** The words each state is read by. Distinct per state: no two states read alike. */
export const STATE_LABEL = Object.freeze({
  LOADING: 'Loading',
  AVAILABLE: 'Available',
  EMPTY: 'Nothing found',
  FAILED: 'Something went wrong',
  UNAVAILABLE: 'Unavailable',
  NOT_CONNECTED: 'Not connected',
  NOT_PERMITTED: 'Not permitted',
  STALE: 'Stale',
  PROCESSING: 'In progress',
  SUCCESS: 'Confirmed',
  NOT_MEASURED: 'Not measured',
  INSUFFICIENT_DATA: 'Insufficient data',
  NO_CONVERSIONS: 'No conversions',
  MIXED_CURRENCY: 'Mixed currencies',
  NOT_SUPPORTED: 'Not supported',
  DISABLED: 'Disabled',
  PARTIAL: 'Partial',
});

/** Pascal-case key used to pick a state's CSS module class (e.g. stateNotMeasured). */
export function stateKey(state) {
  return state.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, letter) => letter.toUpperCase());
}
