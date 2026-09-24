// ============================================================
// roleScope — pure role → surface/permission mapping
// ============================================================
// A Marketing OS is a shared surface. Three collaboration roles work the same
// account with different stakes:
//   STRATEGIST — portfolio / planning / measurement; approves; full surface
//   BUYER      — execution / verdicts / testing; cannot approve
//   CLIENT     — read-only narrative (leadership); sees the REPORT only
//
// Pure, deterministic, no DB. The route layer (requireCollabRole) and the
// client FSM nav both read from here so the gate is defined in ONE place.
// ============================================================

export const WORKSPACE_ROLE = Object.freeze({
  STRATEGIST: 'STRATEGIST',
  BUYER:      'BUYER',
  CLIENT:     'CLIENT',
});

// A missing or future collaboration role has no scope. Phase 6 SC-04 removes
// the old STRATEGIST fallback from both display shaping and permission helpers.

// FSM views each role may see. Maps to client useDecisionFSM view names.
const VISIBLE_STATES = Object.freeze({
  STRATEGIST: ['COMMAND_CENTER', 'PORTFOLIO', 'TESTING', 'MEMORY', 'PLAN', 'MEASURE', 'REPORT'],
  BUYER:      ['COMMAND_CENTER', 'TESTING', 'REPORT'],
  CLIENT:     ['REPORT'],
});

// Retained for existing callers; normalization now refuses unknown values.
export function normalizeRole(role) {
  return asKnownRole(role);
}

/**
 * PURE: the role, or null. No default, ever.
 *
 * The strict role primitive behind normalization, display and authorization.
 * "We could not establish your role" and "your role is STRATEGIST" remain
 * different answers.
 *
 * @param {unknown} role
 * @returns {string|null} a WORKSPACE_ROLE, or null when there is no known seat
 */
export function asKnownRole(role) {
  return Object.values(WORKSPACE_ROLE).includes(role) ? role : null;
}

/** FSM views this role may navigate to. */
export function visibleStates(role) {
  return [...(VISIBLE_STATES[normalizeRole(role)] ?? [])];
}

/** Can this role see a given FSM view? */
export function canSeeState(role, view) {
  return visibleStates(role).includes(view);
}

/** Only strategists approve plans/reallocations. */
export function canApprove(role) {
  return normalizeRole(role) === WORKSPACE_ROLE.STRATEGIST;
}

/** Buyers and strategists can execute; clients never. */
export function canExecute(role) {
  const r = normalizeRole(role);
  return r === WORKSPACE_ROLE.BUYER || r === WORKSPACE_ROLE.STRATEGIST;
}

/** Can this role generate/author a stakeholder narrative? (strategist) */
export function canAuthorNarrative(role) {
  return normalizeRole(role) === WORKSPACE_ROLE.STRATEGIST;
}

/**
 * A handoff legal only along the supervisory grain: a strategist may hand a
 * verdict/plan to a buyer for execution. Clients neither give nor receive.
 */
export function canHandoffTo(fromRole, toRole) {
  // Handoffs are an authorization boundary, so an unknown value remains unknown.
  const from = asKnownRole(fromRole);
  const to = asKnownRole(toRole);
  if (!from || !to) return false;
  if (from === WORKSPACE_ROLE.CLIENT || to === WORKSPACE_ROLE.CLIENT) return false;
  if (from === WORKSPACE_ROLE.STRATEGIST && to === WORKSPACE_ROLE.BUYER) return true;
  if (from === WORKSPACE_ROLE.BUYER && to === WORKSPACE_ROLE.STRATEGIST) return true; // escalate back
  return false;
}
