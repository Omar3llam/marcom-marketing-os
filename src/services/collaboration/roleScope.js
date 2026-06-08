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

// Null/unknown collab role falls back to STRATEGIST so existing seats (who
// predate Phase 8) are never locked out of their own workspace.
export const DEFAULT_ROLE = WORKSPACE_ROLE.STRATEGIST;

// FSM views each role may see. Maps to client useDecisionFSM view names.
const VISIBLE_STATES = Object.freeze({
  STRATEGIST: ['COMMAND_CENTER', 'PORTFOLIO', 'TESTING', 'MEMORY', 'PLAN', 'MEASURE', 'REPORT'],
  BUYER:      ['COMMAND_CENTER', 'TESTING', 'REPORT'],
  CLIENT:     ['REPORT'],
});

export function normalizeRole(role) {
  return Object.values(WORKSPACE_ROLE).includes(role) ? role : DEFAULT_ROLE;
}

/** FSM views this role may navigate to. */
export function visibleStates(role) {
  return [...(VISIBLE_STATES[normalizeRole(role)] ?? VISIBLE_STATES.STRATEGIST)];
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
  const from = normalizeRole(fromRole);
  const to = normalizeRole(toRole);
  if (from === WORKSPACE_ROLE.CLIENT || to === WORKSPACE_ROLE.CLIENT) return false;
  if (from === WORKSPACE_ROLE.STRATEGIST && to === WORKSPACE_ROLE.BUYER) return true;
  if (from === WORKSPACE_ROLE.BUYER && to === WORKSPACE_ROLE.STRATEGIST) return true; // escalate back
  return false;
}
