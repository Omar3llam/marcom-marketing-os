// ============================================================
// MARCOM — Clerk Authentication Middleware (@clerk/express v1+)
// ============================================================
import { clerkMiddleware, getAuth } from '@clerk/express';

/**
 * Apply globally in server.js BEFORE all routes:
 *   app.use(clerkAuthMiddleware());
 *
 * This populates req.auth on every request (unauthenticated
 * requests get req.auth = { userId: null }).
 */
export const clerkAuthMiddleware = clerkMiddleware;

/**
 * Route-level guard: rejects requests where req.auth.userId is absent.
 * Returns 401 { error: 'Unauthenticated' }.
 */
export function requireAuth(req, res, next) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  // Attach for convenience in downstream handlers
  req.userId = auth.userId;
  next();
}
