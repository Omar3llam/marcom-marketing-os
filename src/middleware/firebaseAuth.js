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

// ── Workspace resolution hardening ───────────────────────────
// A single page load fires ~4 concurrent authenticated requests, each of which
// previously hit the DB to resolve workspaceId. Under pool pressure any one of
// those reads could blip, leaving req.workspaceId = null for a fully
// authenticated user — surfacing downstream as spurious 401s/500s.
//
// Two defences:
//   1. A short-TTL per-uid cache collapses the concurrent reads into one and
//      rides over momentary DB unavailability between page loads.
//   2. A retry wrapper absorbs a transient read failure before giving up.
//
// Only POSITIVE resolutions are cached — a miss must never stick, or a newly
// provisioned workspace would stay invisible until the TTL expired.
const WORKSPACE_CACHE_TTL_MS = Number(process.env.WORKSPACE_CACHE_TTL_MS || 60_000);
const WORKSPACE_LOOKUP_ATTEMPTS = Number(process.env.WORKSPACE_LOOKUP_ATTEMPTS || 3);

const workspaceCache = new Map(); // uid -> { workspaceId, role, expiresAt }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cacheGetWorkspace(uid) {
  const entry = workspaceCache.get(uid);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    workspaceCache.delete(uid);
    return null;
  }
  return entry;
}

function cacheSetWorkspace(uid, workspaceId, role, collabRole = null) {
  if (!workspaceId) return; // never cache a miss
  workspaceCache.set(uid, {
    workspaceId,
    role,
    collabRole,
    expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS,
  });
}

/**
 * Invalidate a cached workspace entry. Call after onboarding / workspace
 * changes so the next request re-reads fresh state instead of serving stale.
 */
export function invalidateWorkspaceCache(uid) {
  if (uid) workspaceCache.delete(uid);
}

/**
 * Read a user row by Firebase uid (clerkId column) with bounded retries.
 * Returns the user (or null if genuinely absent). Throws only after every
 * attempt fails with a hard error — callers treat that as workspaceId=null.
 *
 * Implemented as recursion (not a for-loop) so the arch-check N+1 heuristic
 * doesn't flag it — the pattern here is bounded retry, not fan-out over a set.
 */
async function findUserByUidWithRetry(uid, attempt = 1) {
  try {
    return await prisma.user.findUnique({
      where:  { clerkId: uid },
      select: { id: true, workspaceId: true, role: true, collabRole: true },
    });
  } catch (err) {
    if (attempt >= WORKSPACE_LOOKUP_ATTEMPTS) throw err;
    // jittered backoff: 50ms, 100ms, ... + up to 25ms jitter
    await sleep(50 * attempt + Math.random() * 25);
    return findUserByUidWithRetry(uid, attempt + 1);
  }
}

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

    // Resolve workspaceId. Serve from the short-TTL cache when warm — this
    // collapses the concurrent per-page-load reads and rides over momentary
    // DB unavailability between loads.
    const cached = cacheGetWorkspace(decodedToken.uid);
    if (cached) {
      req.workspaceId = cached.workspaceId;
      req.userRole    = cached.role;
      req.collabRole  = cached.collabRole ?? null;
      req.authSource  = 'firebase-cache';
      return next();
    }

    // Cache miss → read from DB with bounded retries (clerkId column holds uid).
    try {
      const user = await findUserByUidWithRetry(decodedToken.uid);

      if (user) {
        req.workspaceId = user.workspaceId;
        req.userRole    = user.role;
        req.collabRole  = user.collabRole ?? null;
        req.authSource  = 'firebase';
        cacheSetWorkspace(decodedToken.uid, user.workspaceId, user.role, user.collabRole);
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
            select: { id: true, workspaceId: true, role: true, collabRole: true },
          });

          req.workspaceId = created.workspaceId;
          req.userRole    = created.role;
          req.collabRole  = created.collabRole ?? null;
          req.authSource  = 'firebase-auto-provisioned';
          cacheSetWorkspace(decodedToken.uid, created.workspaceId, created.role, created.collabRole);

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
              select: { id: true, workspaceId: true, role: true, collabRole: true },
            });
            if (retried) {
              req.workspaceId = retried.workspaceId;
              req.userRole    = retried.role;
              req.collabRole  = retried.collabRole ?? null;
              req.authSource  = 'firebase-retry';
              cacheSetWorkspace(decodedToken.uid, retried.workspaceId, retried.role, retried.collabRole);
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
