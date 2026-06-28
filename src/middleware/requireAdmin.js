// ============================================================
// requireAdmin — system ADMIN gate (UserRole.ADMIN)
// ============================================================
// Mirrors the existing inline ADMIN check in lumi/rollback.js, lifted into a
// reusable middleware. Reads req.userRole, which firebaseAuth.js resolves from
// User.role (granted ONLY via the ADMIN_EMAILS allowlist — never self-serve).
//
// Same shape as requireCollabRole: a thin guard that 403s when the caller is
// not ADMIN. Mount AFTER requireAuth (which guarantees req.user) so an
// unauthenticated caller has already been rejected with 401.
// ============================================================
import { logger } from '../utils/logger.js';

export function requireAdmin(req, res, next) {
  if (req.userRole !== 'ADMIN') {
    logger.warn(
      { path: req.path, method: req.method, userId: req.userId, userRole: req.userRole },
      '[requireAdmin] forbidden',
    );
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
