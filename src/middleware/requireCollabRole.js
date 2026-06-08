// ============================================================
// requireCollabRole — Phase 8 collaboration-role gate
// ============================================================
// Mirrors the Phase-7 requireMeasurementTier shape. Resolves the caller's
// collaboration role (req.collabRole, set by firebaseAuth from User.collabRole;
// null ⇒ STRATEGIST via roleScope so seats predating Phase 8 aren't locked
// out) and 403s if it isn't in the allowed set.
//
// Env override COLLAB_ROLE_OVERRIDE for local/dev (e.g. test the CLIENT view).
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { normalizeRole } from '../services/collaboration/roleScope.js';

/** Resolve the caller's collab role: override → req → DB fallback → default. */
export async function resolveCollabRole(req) {
  const override = process.env.COLLAB_ROLE_OVERRIDE;
  if (override) return normalizeRole(override);
  if (req.collabRole) return normalizeRole(req.collabRole);
  if (req.userId) {
    try {
      const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { collabRole: true } });
      if (u?.collabRole) return normalizeRole(u.collabRole);
    } catch (err) {
      logger.error({ err: err.message, userId: req.userId }, '[requireCollabRole] role fallback failed');
    }
  }
  return normalizeRole(null); // STRATEGIST default
}

/**
 * Gate a route to one or more collab roles.
 * @param {...string} allowed — WorkspaceRole values
 */
export function requireCollabRole(...allowed) {
  return async function collabRoleGate(req, res, next) {
    const role = await resolveCollabRole(req);
    req.collabRole = role; // normalize onto req for downstream handlers
    if (allowed.length > 0 && !allowed.includes(role)) {
      return res.status(403).json({ error: 'RoleForbidden', role, message: `This action requires one of: ${allowed.join(', ')}.` });
    }
    next();
  };
}
