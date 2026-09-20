// ============================================================
// requireCollabRole — Phase 8 collaboration-role gate
// ============================================================
// Resolves the caller's collaboration role (req.collabRole, set by firebaseAuth
// from User.collabRole) and 403s if it isn't in the allowed set.
//
// R11 (I61) — this gate used to fail OPEN, to the highest privilege in the
// system. A swallowed DB error fell through to `normalizeRole(null)`, which
// returns STRATEGIST, so a pool blip during role resolution did not deny the
// request: it promoted it. Twenty-five routes read this gate, including Meta
// execution and artifact approval. Its sibling requirePlan returns 500 on the
// same failure; the two disagreed about what an infrastructure error means.
//
// Now: an infrastructure failure throws and the gate answers 5xx, and an
// unresolvable role denies. Note the deliberate asymmetry with roleScope's
// DEFAULT_ROLE — SURFACING may still default a null role to STRATEGIST so the
// UI renders something, but ENFORCEMENT never does. Generous display, strict
// gate; never the reverse.
//
// Env override COLLAB_ROLE_OVERRIDE is development-only and inert in
// production (see lib/devOverrides.js).
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { devOverride } from '../lib/devOverrides.js';
import { asKnownRole, normalizeRole } from '../services/collaboration/roleScope.js';

/**
 * Raised when the role could not be determined because the identity store was
 * unavailable — as distinct from "this seat has no role", which is a denial.
 * Keeping the two apart is what stops an outage from reading as a permission.
 */
export class RoleUnavailableError extends Error {
  constructor(cause) {
    super('collab role could not be resolved');
    this.name = 'RoleUnavailableError';
    this.cause = cause;
  }
}

/**
 * Resolve the caller's collab role for ENFORCEMENT.
 *
 * @returns {Promise<string|null>} a WORKSPACE_ROLE, or null when the seat
 *          genuinely carries no role (deny).
 * @throws  {RoleUnavailableError} when the lookup itself failed (5xx).
 */
export async function resolveCollabRole(req) {
  // R-14.a — `asKnownRole`, not `normalizeRole`. The difference only shows on a
  // value this gate does not recognise, and there normalizeRole answers
  // STRATEGIST: a seat the gate cannot identify would be ENFORCED as the widest
  // one, and `req.collabRole` arrives here straight from the store
  // (firebaseAuth.js:223), so the promotion would happen before any check ran.
  //
  // No reachable input changes. `User.collabRole` is a Prisma enum
  // (WorkspaceRole?), so only STRATEGIST | BUYER | CLIENT | null can be stored,
  // and all three already pass through unchanged. What this closes is the day
  // the enum gains a fourth value: with normalizeRole that value would be
  // silently enforced as STRATEGIST everywhere; with asKnownRole it is denied
  // until the gate is taught about it. Fail closed on a seat we cannot name.
  const override = devOverride('COLLAB_ROLE_OVERRIDE');
  if (override) return asKnownRole(override);
  if (req.collabRole) return asKnownRole(req.collabRole);
  if (req.userId) {
    try {
      const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { collabRole: true } });
      if (u?.collabRole) return asKnownRole(u.collabRole);
      // The row exists and its role is genuinely unset. Every provisioning path
      // now writes one explicitly and the backfill migration filled the rest,
      // so reaching here means something is wrong with the row — not that the
      // seat should be handed the top role.
      return null;
    } catch (err) {
      logger.error({ err: err.message, userId: req.userId }, '[requireCollabRole] role lookup failed');
      throw new RoleUnavailableError(err);
    }
  }
  return null;
}

/**
 * Why a role could not be established. Two reasons, because they have two
 * different next steps (C-07: a token cannot replace a reason).
 *
 *   ROLE_UNSET          the row was read and carries no collaboration role.
 *                       A retry changes nothing; a Strategist must assign one.
 *                       This is the same condition requireCollabRole already
 *                       answers with 403 "Ask a workspace Strategist to set one".
 *   ROLE_LOOKUP_FAILED  the read itself failed. A retry is honest.
 */
export const ROLE_UNRESOLVED_REASON = Object.freeze({
  ROLE_UNSET: 'ROLE_UNSET',
  ROLE_LOOKUP_FAILED: 'ROLE_LOOKUP_FAILED',
});

/**
 * R-14.a — resolve the caller's seat for PUBLICATION, with no default.
 *
 * The question this answers is "what seat is this", and the honest set of
 * answers includes "we could not tell". `resolveCollabRoleForDisplay` below
 * cannot express that: it maps every failure onto DEFAULT_ROLE, which is how a
 * database blip came to be published as a confirmed STRATEGIST.
 *
 * Never throws — the caller gets a described outcome instead of an exception,
 * because an endpoint that reports a seat should still answer when it cannot
 * find one.
 *
 * @returns {Promise<{status:'RESOLVED', role:string, reason:null}
 *                 | {status:'UNRESOLVED', role:null, reason:string}>}
 */
export async function resolveCollabRoleContext(req) {
  let role;
  try {
    role = await resolveCollabRole(req);
  } catch (err) {
    logger.error({ err: err.message, userId: req?.userId }, '[requireCollabRole] role context unresolvable');
    return { status: 'UNRESOLVED', role: null, reason: ROLE_UNRESOLVED_REASON.ROLE_LOOKUP_FAILED };
  }
  const known = asKnownRole(role);
  return known
    ? { status: 'RESOLVED', role: known, reason: null }
    : { status: 'UNRESOLVED', role: null, reason: ROLE_UNRESOLVED_REASON.ROLE_UNSET };
}

/**
 * Resolve a role for DISPLAY / surfacing, where the question is "what should
 * this screen show" rather than "may this act". Never throws; an unresolvable
 * role renders as the default seat. Callers must not use this to gate.
 *
 * ⚠️ R-14.a — this must NOT be used to publish a seat. It answers with
 * DEFAULT_ROLE when nothing could be resolved, so its answer is a shaping
 * choice, not a fact about the caller. `GET /api/lumi/roles/me` used it and
 * therefore told the client STRATEGIST during an outage; it now uses
 * `resolveCollabRoleContext` above.
 *
 * Three callers remain, all of them role-SCOPED CONTENT rather than an access
 * claim (/inbox, /home, feedSurfacing). They are recorded as follow-ups in
 * PHASE_5_14 rather than changed here, because narrowing them changes what data
 * those surfaces return, which is a product decision and not this ruling.
 */
export async function resolveCollabRoleForDisplay(req) {
  try {
    return normalizeRole(await resolveCollabRole(req));
  } catch {
    return normalizeRole(null);
  }
}

/**
 * Gate a route to one or more collab roles.
 * @param {...string} allowed — WorkspaceRole values
 */
export function requireCollabRole(...allowed) {
  return async function collabRoleGate(req, res, next) {
    let role;
    try {
      role = await resolveCollabRole(req);
    } catch (err) {
      // Fail closed and say so. This is the whole point of the middleware.
      logger.error({ err: err.message, userId: req.userId, path: req.path }, '[requireCollabRole] denying — role unresolvable');
      return res.status(503).json({
        error:   'RoleUnavailable',
        message: 'Could not determine your permissions right now. Try again shortly.',
      });
    }

    if (!role) {
      return res.status(403).json({
        error:   'RoleForbidden',
        role:    null,
        message: 'This seat has no collaboration role assigned. Ask a workspace Strategist to set one.',
      });
    }

    req.collabRole = role; // normalize onto req for downstream handlers
    if (allowed.length > 0 && !allowed.includes(role)) {
      return res.status(403).json({ error: 'RoleForbidden', role, message: `This action requires one of: ${allowed.join(', ')}.` });
    }
    next();
  };
}
