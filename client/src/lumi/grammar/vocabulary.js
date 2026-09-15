// ============================================================
// Grammar vocabulary — read from the contracts, never re-listed
// ------------------------------------------------------------
// Verdicts and Decision statuses come from the client parse layer (B8-01), and
// Decision classes and knowledge tokens from @marcom/runtime-contracts (C-06,
// C-10). A LUMI part that typed its own copy of a vocabulary would be the
// second verdict map the audit already counted (audit §15).
//
// THE STATE REGISTRY below mirrors semantic.json `$states` (the 17 locked
// states and their illumination class). It is declared, not imported, so the
// token source stays out of the bundle; `states.test.jsx` holds the two equal
// in both directions.
// ============================================================
import { DECISION_CLASS, KNOWLEDGE } from '@marcom/runtime-contracts';
import { DecisionStatusSchema, VerdictSchema } from '@/contracts/schemas/decision.schema';

export const VERDICTS = Object.freeze([...VerdictSchema.options]);
export const DECISION_STATUSES = Object.freeze([...DecisionStatusSchema.options]);
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
