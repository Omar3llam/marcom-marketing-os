// ============================================================
// MARCOM — Firebase Authentication Middleware
// ------------------------------------------------------------
// Verifies Firebase ID tokens and attaches decoded user data
// to req.user (including uid, email, etc.).
//
// Replaces the old Clerk auth middleware.
// ============================================================
import admin from '../utils/firebaseAdmin.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware: Verify Firebase ID token from Authorization header.
 * Populates req.user with decoded token data on success.
 * Also resolves req.workspaceId from the database using Firebase uid.
 * Does NOT reject requests — just sets req.user to null if invalid.
 *
 * Use this globally in server.js BEFORE all routes:
 *   app.use(firebaseAuthMiddleware);
 */
export async function firebaseAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    req.userId = null;
    req.workspaceId = null;
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;

    // For backward compatibility with existing code that uses req.userId
    req.userId = decodedToken.uid;

    // Resolve workspaceId from database using Firebase uid (stored in clerkId column)
    try {
      const user = await prisma.user.findUnique({
        where: { clerkId: decodedToken.uid },
        select: { id: true, workspaceId: true, role: true },
      });

      if (user) {
        req.workspaceId = user.workspaceId;
        req.userRole    = user.role;
        req.authSource  = 'firebase';
      } else {
        // No Prisma row for this Firebase UID.
        // Auto-provision: create Workspace + User atomically so the
        // session is immediately functional. context=null means the user
        // is NOT onboarded — ProtectedRoute will redirect to /onboarding.
        try {
          const email       = decodedToken.email || `${decodedToken.uid}@unknown.local`;
          const displayName = decodedToken.name  || email.split('@')[0];

          const created = await prisma.user.create({
            data: {
              clerkId:  decodedToken.uid,
              email,
              role:     'VIEWER',
              context:  null,           // null = not onboarded yet
              workspace: {
                create: { name: `${displayName}'s Workspace` },
              },
            },
            select: { id: true, workspaceId: true, role: true },
          });

          req.workspaceId = created.workspaceId;
          req.userRole    = created.role;
          req.authSource  = 'firebase-auto-provisioned';

          logger.info(
            { uid: decodedToken.uid, workspaceId: created.workspaceId },
            '[firebase-auth] auto-provisioned User + Workspace for new Firebase user',
          );
        } catch (provisionErr) {
          // Likely a unique-constraint race (two simultaneous requests).
          // Try a second read before giving up.
          try {
            const retried = await prisma.user.findUnique({
              where:  { clerkId: decodedToken.uid },
              select: { id: true, workspaceId: true, role: true },
            });
            if (retried) {
              req.workspaceId = retried.workspaceId;
              req.userRole    = retried.role;
              req.authSource  = 'firebase-retry';
            } else {
              req.workspaceId = null;
              logger.error(
                { uid: decodedToken.uid, err: provisionErr.message },
                '[firebase-auth] auto-provision failed and retry also failed',
              );
            }
          } catch (retryErr) {
            req.workspaceId = null;
            logger.error({ err: retryErr.message }, '[firebase-auth] auto-provision retry threw');
          }
        }
      }
    } catch (dbErr) {
      logger.warn({ err: dbErr.message, uid: decodedToken.uid }, '[firebase-auth] workspace lookup failed');
      req.workspaceId = null;
    }

    // Log successful auth (optional, enable with LOG_LEVEL=debug)
    logger.debug({ uid: decodedToken.uid, email: decodedToken.email }, '[firebase-auth] Token verified ✓');
  } catch (err) {
    // Token verification failed — classify the error for better diagnostics.
    // Route-level guards (requireAuth) will handle rejection.
    const errorCode = err?.code || err?.errorInfo?.code;
    const errorMessage = err?.message || 'Unknown error';

    // Firebase Admin SDK error codes: https://firebase.google.com/docs/auth/admin/errors
    const classification = {
      // Token expiry
      'auth/id-token-expired': { level: 'info', reason: 'Token expired (>1 hour old)', action: 'Client will refresh automatically' },
      'auth/session-cookie-expired': { level: 'info', reason: 'Session expired', action: 'Re-authentication required' },

      // Invalid tokens
      'auth/id-token-revoked': { level: 'warn', reason: 'Token revoked by user/admin', action: 'Force re-login' },
      'auth/invalid-id-token': { level: 'warn', reason: 'Malformed token', action: 'Check token format' },
      'auth/argument-error': { level: 'warn', reason: 'Invalid token argument', action: 'Check Authorization header' },

      // Firebase service issues
      'auth/internal-error': { level: 'error', reason: 'Firebase verification service error', action: 'Check Firebase status' },
      'auth/network-request-failed': { level: 'error', reason: 'Network error contacting Firebase', action: 'Check connectivity' },
    }[errorCode] || { level: 'warn', reason: 'Unknown verification failure', action: 'Check logs' };

    logger[classification.level]({
      errorCode,
      errorMessage,
      reason: classification.reason,
      action: classification.action,
      tokenPrefix: token.slice(0, 20) + '...',
      path: req.path,
      method: req.method,
    }, `[firebase-auth] ${classification.reason}`);

    req.user = null;
    req.userId = null;
    req.workspaceId = null;
  }

  next();
}

/**
 * Route-level guard: Rejects requests where req.user is absent.
 * Returns 401 { error: 'Unauthenticated' }.
 *
 * Use this on protected routes:
 *   router.get('/protected', requireAuth, (req, res) => { ... });
 */
export function requireAuth(req, res, next) {
  if (!req.user || !req.user.uid) {
    // Log 401 rejections for debugging (includes path/method for correlation)
    logger.debug({
      path: req.path,
      method: req.method,
      hasAuthHeader: !!req.headers.authorization,
      reason: req.headers.authorization ? 'Token invalid/expired' : 'No Authorization header',
    }, '[firebase-auth] requireAuth rejected request');

    return res.status(401).json({ error: 'Unauthenticated' });
  }

  // Ensure req.userId is set for backward compatibility
  req.userId = req.user.uid;

  next();
}
