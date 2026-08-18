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
import { normalizeRole } from '../services/collaboration/roleScope.js';

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
  const override = devOverride('COLLAB_ROLE_OVERRIDE');
  if (override) return normalizeRole(override);
  if (req.collabRole) return normalizeRole(req.collabRole);
  if (req.userId) {
    try {
      const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { collabRole: true } });
      if (u?.collabRole) return normalizeRole(u.collabRole);
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
 * Resolve a role for DISPLAY / surfacing, where the question is "what should
 * this screen show" rather than "may this act". Never throws; an unresolvable
 * role renders as the default seat. Callers must not use this to gate.
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
