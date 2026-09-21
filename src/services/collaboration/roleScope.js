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
//
// ⚠️ R-14.a (Phase 5.14) — THIS DEFAULT MAY NOT BE PUBLISHED AS A ROLE.
// It exists so a role-SCOPED view can still compose something; it is not an
// answer to "what seat is this". GET /api/lumi/roles/me used to hand it to the
// client through `resolveCollabRoleForDisplay`, and the client, seeing a
// recognised role, recorded a CONFIRMED STRATEGIST — so a database blip or an
// unassigned seat rendered the full operator surface. Anything that PUBLISHES a
// seat must read `asKnownRole` below, which has no default.
//
// The default is left in place for the callers that legitimately need a concrete
// role AFTER enforcement has already run, and for the role-scoped composers
// (/inbox, /home, feedSurfacing) whose blast radius is data shaping rather than
// an access claim. Those are recorded as follow-ups, not silently changed here.
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

/**
 * PURE: the role, or null. No default, ever.
 *
 * The counterpart to `normalizeRole` for every path that reports a seat rather
 * than shapes a view. "We could not establish your role" and "your role is
 * STRATEGIST" are different answers, and only this function can express the
 * first one.
 *
 * @param {unknown} role
 * @returns {string|null} a WORKSPACE_ROLE, or null when there is no known seat
 */
export function asKnownRole(role) {
  return Object.values(WORKSPACE_ROLE).includes(role) ? role : null;
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
  // Handoffs are an authorization boundary, so an unknown value must remain
  // unknown. normalizeRole is intentionally generous for display shaping and
  // would otherwise promote an unrecognised role to STRATEGIST here.
  const from = asKnownRole(fromRole);
  const to = asKnownRole(toRole);
  if (!from || !to) return false;
  if (from === WORKSPACE_ROLE.CLIENT || to === WORKSPACE_ROLE.CLIENT) return false;
  if (from === WORKSPACE_ROLE.STRATEGIST && to === WORKSPACE_ROLE.BUYER) return true;
  if (from === WORKSPACE_ROLE.BUYER && to === WORKSPACE_ROLE.STRATEGIST) return true; // escalate back
  return false;
}
