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
        req.userRole = user.role;
        req.authSource = 'firebase';
      } else {
        req.workspaceId = null;
      }
    } catch (dbErr) {
      logger.warn({ err: dbErr.message, uid: decodedToken.uid }, '[firebase-auth] workspace lookup failed');
      req.workspaceId = null;
    }

    // Log successful auth (optional, remove in production for less noise)
    // logger.debug({ uid: decodedToken.uid, email: decodedToken.email }, '[firebase-auth] Token verified');
  } catch (err) {
    // Token verification failed — log but don't reject the request.
    // Route-level guards (requireAuth) will handle rejection.
    logger.warn({ err: err.message, token: token.slice(0, 20) + '...' }, '[firebase-auth] Token verification failed');
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
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  // Ensure req.userId is set for backward compatibility
  req.userId = req.user.uid;

  next();
}
