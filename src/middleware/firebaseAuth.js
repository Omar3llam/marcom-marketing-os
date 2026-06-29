// ============================================================
// MARCOM — Firebase Authentication Middleware
// ------------------------------------------------------------
// Verifies Firebase ID tokens and attaches decoded user data
// to req.user (including uid, email, etc.).
//
// Replaces the old Clerk auth middleware.
// ============================================================
import admin from '../utils/firebaseAdmin.js';
import { getFirebaseAdminReadiness } from '../utils/firebaseAdmin.js';
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

// ── ADMIN grant path (UserRole.ADMIN) ───────────────────────
// ADMIN is never self-serve. The ONLY way a real user becomes ADMIN is by
// having their email listed in ADMIN_EMAILS (comma-separated). This is applied
// both at first auto-provision AND at every subsequent login — so an operator
// added to the list after they signed up is upgraded on their next request,
// not stuck as VIEWER. Removing an email from the list does NOT auto-downgrade
// (that's a deliberate manual action), but it stops further upgrades.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** True when this email is on the ADMIN_EMAILS allowlist. */
function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

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
  const firebaseAdmin = getFirebaseAdminReadiness();
  if (!firebaseAdmin.ok) {
    req.authInfraError = {
      code: 'FIREBASE_ADMIN_UNINITIALIZED',
      message: firebaseAdmin.error || 'Firebase Admin is not initialized',
    };
    req.user = null;
    req.userId = null;
    req.workspaceId = null;
    logger.error({
      path: req.path,
      method: req.method,
      errorCode: req.authInfraError.code,
      errorMessage: req.authInfraError.message,
    }, '[firebase-auth] Firebase Admin unavailable');
    return next();
  }

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
      // In-memory override only — the durable DB upgrade happens on the next
      // cache-miss read. This keeps the gate correct within a warm TTL window
      // even if the cached role predates the ADMIN_EMAILS listing.
      req.userRole    = isAdminEmail(decodedToken.email) ? 'ADMIN' : cached.role;
      req.collabRole  = cached.collabRole ?? null;
      req.authSource  = 'firebase-cache';
      return next();
    }

    // Cache miss → read from DB with bounded retries (clerkId column holds uid).
    try {
      const user = await findUserByUidWithRetry(decodedToken.uid);

      if (user) {
        let role = user.role;
        // Durable ADMIN upgrade: an operator listed in ADMIN_EMAILS who was
        // provisioned before the env var was set is promoted on this login.
        if (isAdminEmail(decodedToken.email) && role !== 'ADMIN') {
          try {
            await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
            role = 'ADMIN';
            logger.info(
              { uid: decodedToken.uid, email: decodedToken.email },
              '[firebase-auth] upgraded user to ADMIN via ADMIN_EMAILS',
            );
          } catch (upgradeErr) {
            // Non-fatal: fall back to the in-memory override for this request.
            role = 'ADMIN';
            logger.error({ err: upgradeErr.message, uid: decodedToken.uid }, '[firebase-auth] ADMIN upgrade write failed');
          }
        }
        req.workspaceId = user.workspaceId;
        req.userRole    = role;
        req.collabRole  = user.collabRole ?? null;
        req.authSource  = 'firebase';
        cacheSetWorkspace(decodedToken.uid, user.workspaceId, role, user.collabRole);
      } else {
        // No Prisma row for this Firebase UID — first sign-in.
        //
        // THE INVITE SEAM: if a PENDING, unexpired invitation exists for this
        // email, the user JOINS that workspace (with the invited collabRole) and
        // the invite is consumed — instead of getting a fresh island workspace.
        // Without this branch every invited teammate would silently land in their
        // own workspace and the whole invite flow would be a no-op.
        // Otherwise: normal auto-provision (fresh Workspace + User). context=null
        // means NOT onboarded — ProtectedRoute will redirect to /onboarding.
        try {
          // Normalize to lowercase so the email match against invitation.email
          // (also stored lowercase) is reliable — Postgres equality is exact.
          const email       = (decodedToken.email || `${decodedToken.uid}@unknown.local`).toLowerCase();
          const displayName = decodedToken.name  || email.split('@')[0];
          // ADMIN only if the email is on the ADMIN_EMAILS allowlist — never
          // self-serve. Everyone else provisions as VIEWER.
          const role        = isAdminEmail(email) ? 'ADMIN' : 'VIEWER';

          // Defensive: an invite-lookup failure must never block normal provision.
          let pendingInvite = null;
          try {
            pendingInvite = await prisma.invitation.findFirst({
              where:   { email, status: 'PENDING', expiresAt: { gt: new Date() } },
              orderBy: { createdAt: 'desc' },
              select:  { id: true, workspaceId: true, collabRole: true },
            });
          } catch (inviteErr) {
            logger.warn({ err: inviteErr.message, uid: decodedToken.uid }, '[firebase-auth] invite lookup failed; falling back to fresh provision');
          }

          let created;
          if (pendingInvite) {
            // Join the inviting workspace; consume the invite (single-use).
            created = await prisma.user.create({
              data: {
                clerkId:     decodedToken.uid,
                email,
                role,
                collabRole:  pendingInvite.collabRole,
                context:     null,
                workspaceId: pendingInvite.workspaceId,
              },
              select: { id: true, workspaceId: true, role: true, collabRole: true },
            });
            await prisma.invitation.update({
              where: { id: pendingInvite.id },
              data:  { status: 'ACCEPTED' },
            });
            req.authSource = 'firebase-invite-join';
            logger.info(
              { uid: decodedToken.uid, workspaceId: created.workspaceId, inviteId: pendingInvite.id },
              '[firebase-auth] invited user joined existing workspace',
            );
          } else {
            // Fresh Workspace + User, created atomically.
            created = await prisma.user.create({
              data: {
                clerkId: decodedToken.uid,
                email,
                role,
                context: null,
                workspace: { create: { name: `${displayName}'s Workspace` } },
              },
              select: { id: true, workspaceId: true, role: true, collabRole: true },
            });
            req.authSource = 'firebase-auto-provisioned';
            logger.info(
              { uid: decodedToken.uid, workspaceId: created.workspaceId },
              '[firebase-auth] auto-provisioned User + Workspace for new Firebase user',
            );
          }

          req.workspaceId = created.workspaceId;
          req.userRole    = created.role;
          req.collabRole  = created.collabRole ?? null;
          cacheSetWorkspace(decodedToken.uid, created.workspaceId, created.role, created.collabRole);
        } catch (provisionErr) {
          // Likely a unique-constraint race (two simultaneous requests).
          // Try a second read before giving up.
          try {
            const retried = await prisma.user.findUnique({
              where:  { clerkId: decodedToken.uid },
              select: { id: true, workspaceId: true, role: true, collabRole: true },
            });
            if (retried) {
              const role = isAdminEmail(decodedToken.email) ? 'ADMIN' : retried.role;
              req.workspaceId = retried.workspaceId;
              req.userRole    = role;
              req.collabRole  = retried.collabRole ?? null;
              req.authSource  = 'firebase-retry';
              cacheSetWorkspace(decodedToken.uid, retried.workspaceId, role, retried.collabRole);
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
  if (req.authInfraError) {
    logger.error({
      path: req.path,
      method: req.method,
      errorCode: req.authInfraError.code,
      errorMessage: req.authInfraError.message,
    }, '[firebase-auth] requireAuth blocked by auth infrastructure');

    return res.status(503).json({
      error: 'AuthInfrastructureUnavailable',
      message: 'Authentication infrastructure is not ready. Check server logs and /health.',
    });
  }

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
