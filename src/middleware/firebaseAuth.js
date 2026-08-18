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
//
// R11 (I56): the allowlist is matched against a VERIFIED email only. Firebase
// will mint an identity for any address a client types into the email/password
// signup form; `email_verified` is the only claim that says the holder of that
// address consented. Before R11 this check read `decodedToken.email` directly,
// so registering an ADMIN_EMAILS address through the app's own signup form
// granted the admin panel outright.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * R11 (I56) — has this identity proven control of its email address?
 *
 * Strictly `=== true`. Firebase omits the claim entirely for some providers and
 * sets it false for unverified email/password accounts; neither is proof, and
 * a truthy check would let `undefined` through the moment a provider changed
 * its claim set.
 */
export function hasVerifiedEmail(decodedToken) {
  return decodedToken?.email_verified === true
    && typeof decodedToken?.email === 'string'
    && decodedToken.email.length > 0;
}

/** True when this token carries a VERIFIED email on the ADMIN_EMAILS allowlist. */
function isVerifiedAdmin(decodedToken) {
  if (!hasVerifiedEmail(decodedToken)) return false;
  return ADMIN_EMAILS.includes(decodedToken.email.toLowerCase());
}

/**
 * R11 (I58) — the invitation credential travels as a request header, not as a
 * body/query field and not as an email match. It is a server-issued secret
 * checked against a DB row, which is exactly what an `Authorization` header is;
 * it is NOT a self-asserted identity claim, so it does not violate I59.
 */
const INVITE_TOKEN_HEADER = 'x-invitation-token';

function readInviteToken(req) {
  const raw = req.headers?.[INVITE_TOKEN_HEADER];
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  return token.length > 0 && token.length <= 200 ? token : null;
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
      req.userRole    = isVerifiedAdmin(decodedToken) ? 'ADMIN' : cached.role;
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
        if (isVerifiedAdmin(decodedToken) && role !== 'ADMIN') {
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
        // THE INVITE SEAM (R11, I58). Before R11 this branch matched a PENDING
        // invitation on `decodedToken.email` and granted membership on that
        // match alone. The invitation TOKEN — a server-issued single-use secret,
        // minted by POST /invite and surfaced by GET /invite/accept — was never
        // consulted at the moment membership was granted, so registering an
        // invited address through the public signup form joined the inviting
        // workspace outright. The strong credential existed and was ignored.
        //
        // Now the token IS the membership credential: it arrives as a request
        // header, is claimed atomically inside a transaction, and an email match
        // grants nothing. No token ⇒ a fresh island workspace, which is the
        // correct outcome for a genuinely new signup and confers no authority
        // derived from the email claim. context=null means NOT onboarded —
        // ProtectedRoute will redirect to /onboarding.
        const inviteToken = readInviteToken(req);
        try {
          // Stored lowercase so the roster/uniqueness comparisons are reliable.
          // R11 (I57): this is a CONTACT attribute written onto the new row. It
          // is never used to find, adopt, or authorise an existing row.
          const email       = (decodedToken.email || `${decodedToken.uid}@unknown.local`).toLowerCase();
          const displayName = decodedToken.name  || email.split('@')[0];
          // ADMIN only if a VERIFIED email is on the ADMIN_EMAILS allowlist —
          // never self-serve. Everyone else provisions as VIEWER.
          const role        = isVerifiedAdmin(decodedToken) ? 'ADMIN' : 'VIEWER';

          let created;
          if (inviteToken) {
            // ── Token-based join ────────────────────────────────
            // The claim and the membership write share one transaction: the
            // updateMany's WHERE is the atomic single-use gate (only one
            // concurrent caller can move a row out of PENDING), and if the
            // user create then fails the claim rolls back with it. A consumed
            // invitation and an un-created member can never coexist.
            let claimed;
            try {
              claimed = await prisma.$transaction(async (tx) => {
                const claim = await tx.invitation.updateMany({
                  where: { token: inviteToken, status: 'PENDING', expiresAt: { gt: new Date() } },
                  data:  { status: 'ACCEPTED' },
                });
                if (claim.count !== 1) return null;

                const invite = await tx.invitation.findUnique({
                  where:  { token: inviteToken },
                  select: { id: true, workspaceId: true, collabRole: true },
                });
                if (!invite) return null;

                const user = await tx.user.create({
                  data: {
                    clerkId:     decodedToken.uid,
                    email,
                    role,
                    collabRole:  invite.collabRole,
                    context:     null,
                    workspaceId: invite.workspaceId,
                  },
                  select: { id: true, workspaceId: true, role: true, collabRole: true },
                });
                return { user, inviteId: invite.id };
              });
            } catch (claimErr) {
              // A DB failure here is NOT "the invitation does not exist".
              // Refusing loudly keeps security state and unavailable state
              // distinct (I71) — a silent fall-through to fresh provisioning
              // would strand an invited teammate in an island workspace and
              // burn the only invite they were sent.
              logger.error(
                { err: claimErr.message, uid: decodedToken.uid },
                '[firebase-auth] invitation claim failed',
              );
              throw Object.assign(new Error('invitation claim failed'), { authStatus: 503, authCode: 'INVITATION_UNAVAILABLE' });
            }

            if (!claimed) {
              // The token is absent, expired, or already consumed. This is a
              // refusal, not a reason to provision something else.
              throw Object.assign(new Error('invitation invalid'), { authStatus: 403, authCode: 'INVITATION_INVALID' });
            }

            created = claimed.user;
            req.authSource = 'firebase-invite-join';
            logger.info(
              { uid: decodedToken.uid, workspaceId: created.workspaceId, inviteId: claimed.inviteId },
              '[firebase-auth] invited user joined existing workspace via invitation token',
            );
          } else {
            // Fresh Workspace + User, created atomically.
            created = await prisma.user.create({
              data: {
                clerkId: decodedToken.uid,
                email,
                role,
                // R11 (I61/I63): write the seat explicitly. The person who
                // mints a workspace IS its strategist — that was always the
                // product truth, it was just left implicit in a null that the
                // gate then had to interpret. With the role written here (and
                // backfilled for existing rows), a null collabRole stops
                // meaning "assume the top role" and starts meaning "something
                // is wrong with this row", which is a denial.
                collabRole: 'STRATEGIST',
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
          // A deliberate refusal (bad invitation, unavailable claim) is already
          // a decision — propagate it verbatim rather than re-reading the DB.
          if (provisionErr.authStatus) {
            req.workspaceId = null;
            req.authError = { status: provisionErr.authStatus, code: provisionErr.authCode, message: provisionErr.message };
          } else {
            // Otherwise: most likely a unique-constraint race between two
            // simultaneous first requests. Try a second read before giving up.
            try {
              const retried = await prisma.user.findUnique({
                where:  { clerkId: decodedToken.uid },
                select: { id: true, workspaceId: true, role: true, collabRole: true },
              });
              if (retried) {
                const role = isVerifiedAdmin(decodedToken) ? 'ADMIN' : retried.role;
                req.workspaceId = retried.workspaceId;
                req.userRole    = role;
                req.collabRole  = retried.collabRole ?? null;
                req.authSource  = 'firebase-retry';
                cacheSetWorkspace(decodedToken.uid, retried.workspaceId, role, retried.collabRole);
              } else if (provisionErr.code === 'P2002') {
                // The row that blocked the insert is NOT this uid's — the only
                // other unique column on User is `email`. That address already
                // belongs to a different identity, and adopting it is precisely
                // the takeover R11 closes. Refuse, distinctly (I73): this is
                // neither "unauthenticated" nor "service unavailable".
                req.workspaceId = null;
                req.authError = {
                  status: 409,
                  code: 'EMAIL_ALREADY_LINKED',
                  message: 'This email address is already linked to a different account.',
                };
                logger.error(
                  { uid: decodedToken.uid, target: provisionErr.meta?.target },
                  '[firebase-auth] provisioning refused — email already linked to another identity',
                );
              } else {
                req.workspaceId = null;
                req.authError = { status: 503, code: 'PROVISIONING_UNAVAILABLE', message: 'Could not provision this account.' };
                logger.error(
                  { uid: decodedToken.uid, err: provisionErr.message },
                  '[firebase-auth] auto-provision failed and retry also failed',
                );
              }
            } catch (retryErr) {
              req.workspaceId = null;
              req.authError = { status: 503, code: 'PROVISIONING_UNAVAILABLE', message: 'Could not provision this account.' };
              logger.error({ err: retryErr.message }, '[firebase-auth] auto-provision retry threw');
            }
          }
        }
      }
    } catch (dbErr) {
      // R11 (I71): identity infrastructure failure is NOT "this user has no
      // workspace". Leaving workspaceId null here used to hand the request on
      // to handlers that then queried `workspaceId: null` — a non-nullable UUID
      // column that matches nothing — and returned 200 with an empty account.
      // A paying customer saw their data vanish because a pool read blipped.
      logger.error({ err: dbErr.message, uid: decodedToken.uid }, '[firebase-auth] identity lookup failed');
      req.workspaceId = null;
      req.authError = { status: 503, code: 'IDENTITY_UNAVAILABLE', message: 'Could not resolve this account right now.' };
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

  // R11 (I71/I73): the identity layer reached a decision that is neither
  // "authenticated" nor "anonymous" — a refused invitation, an email already
  // bound to another identity, or an unavailable identity store. Each keeps its
  // own status code; none of them is allowed to proceed as a contextless 200.
  if (req.authError) {
    logger.warn({
      path:   req.path,
      method: req.method,
      uid:    req.user?.uid,
      code:   req.authError.code,
    }, '[firebase-auth] requireAuth blocked by identity-layer decision');

    return res.status(req.authError.status).json({
      error:   req.authError.code,
      message: req.authError.message,
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
