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
// unresolvable role denies. Role-scoped content also requires a known seat;
// absence cannot be used as display authority.
//
// Env override COLLAB_ROLE_OVERRIDE is development-only and inert in
// production (see lib/devOverrides.js).
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { devOverride } from '../lib/devOverrides.js';
import { asKnownRole } from '../services/collaboration/roleScope.js';

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
 *          carries no known role (deny).
 * @throws  {RoleUnavailableError} when the lookup itself failed (5xx).
 */
async function readRawCollabRole(req) {
  const override = devOverride('COLLAB_ROLE_OVERRIDE');
  if (override) return { rawRole: override, identityFound: true };
  if (req?.collabRole != null) return { rawRole: req.collabRole, identityFound: true };
  if (req?.userId) {
    try {
      const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { collabRole: true } });
      return { rawRole: u?.collabRole ?? null, identityFound: Boolean(u) };
    } catch (err) {
      logger.error({ err: err.message, userId: req.userId }, '[requireCollabRole] role lookup failed');
      throw new RoleUnavailableError(err);
    }
  }
  return { rawRole: null, identityFound: false };
}

export async function resolveCollabRole(req) {
  const { rawRole } = await readRawCollabRole(req);
  return asKnownRole(rawRole);
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
 *   ROLE_UNKNOWN        a stored or cached role is not understood here.
 *   ROLE_IDENTITY_MISSING  no user identity or row established a seat.
 */
export const ROLE_UNRESOLVED_REASON = Object.freeze({
  ROLE_UNSET: 'ROLE_UNSET',
  ROLE_LOOKUP_FAILED: 'ROLE_LOOKUP_FAILED',
  ROLE_UNKNOWN: 'ROLE_UNKNOWN',
  ROLE_IDENTITY_MISSING: 'ROLE_IDENTITY_MISSING',
});

/**
 * R-14.a — resolve the caller's seat for PUBLICATION, with no default.
 *
 * The question this answers is "what seat is this", and the honest set of
 * answers includes "we could not tell". The old display resolver turned that
 * absence into STRATEGIST, so role-scoped content appeared complete on outage.
 *
 * Never throws — the caller gets a described outcome instead of an exception,
 * because an endpoint that reports a seat should still answer when it cannot
 * find one.
 *
 * @returns {Promise<{status:'RESOLVED', role:string, reason:null}
 *                 | {status:'UNRESOLVED', role:null, reason:string}>}
 */
export async function resolveCollabRoleContext(req) {
  let reading;
  try {
    reading = await readRawCollabRole(req);
  } catch (err) {
    logger.error({ err: err.message, userId: req?.userId }, '[requireCollabRole] role context unresolvable');
    return { status: 'UNRESOLVED', role: null, reason: ROLE_UNRESOLVED_REASON.ROLE_LOOKUP_FAILED };
  }
  const known = asKnownRole(reading.rawRole);
  const reason = reading.rawRole != null
    ? ROLE_UNRESOLVED_REASON.ROLE_UNKNOWN
    : reading.identityFound
      ? ROLE_UNRESOLVED_REASON.ROLE_UNSET
      : ROLE_UNRESOLVED_REASON.ROLE_IDENTITY_MISSING;
  return known
    ? { status: 'RESOLVED', role: known, reason: null }
    : { status: 'UNRESOLVED', role: null, reason };
}

/**
 * Compatibility helper for display consumers: a known role or null. New
 * role-scoped routes use requireResolvedCollabRole so they also publish the
 * reason when the role is unresolved.
 */
export async function resolveCollabRoleForDisplay(req) {
  return (await resolveCollabRoleContext(req)).role;
}

/** Require a known role before composing role-scoped read content. */
export async function requireResolvedCollabRole(req, res, next) {
  const ctx = await resolveCollabRoleContext(req);
  if (ctx.status === 'RESOLVED') {
    req.collabRole = ctx.role;
    return next();
  }
  const unset = ctx.reason === ROLE_UNRESOLVED_REASON.ROLE_UNSET;
  return res.status(unset ? 409 : 503).json({
    error: unset ? 'RoleNotConfigured' : 'RoleUnavailable',
    roleStatus: ctx.status,
    roleReason: ctx.reason,
    message: unset ? 'This seat has no collaboration role assigned.' : 'Could not determine your collaboration role right now.',
  });
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
