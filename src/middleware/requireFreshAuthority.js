// ============================================================
// requireFreshAuthority — the money boundary re-establishes authority
// ============================================================
// SLICE B. The product had two ways for authority to outlive its revocation,
// and both of them ended at the only two paths that can spend real money:
//
//   Firebase ID token    revocation was never consulted   → up to 1 HOUR
//   collab-role cache    60s TTL, invalidated by nobody   → up to 60 SECONDS
//
//   A principal whose mutation authority has been revoked cannot cause a
//   real-money platform mutation through either canonical mutation path,
//   regardless of previously cached role state or previously issued Firebase
//   credentials.
//
// WHY HERE AND NOT AT THE FRONT DOOR. Consulting Firebase revocation on every
// request turns a local signature check into a network round trip against
// Firebase for the entire API, and re-reading the user row on every request
// undoes the cache that exists because page loads fan out. Neither cost buys
// anything on a read. So freshness is guaranteed where the consequence is
// irreversible — POST /execute/meta and POST /execute/:id/retry, which are the
// ONLY two callers of enqueueExecution and the only two writers of
// ExecutionRequest — and the rest of the API keeps the cheap path.
//
// Both routes are rate-limited to 20/min per workspace, so the added cost is
// bounded by a number that already exists.
//
// WHAT MAKES EACH CHECK AUTHORITATIVE, and why neither is a cache flush:
//
//   CREDENTIAL  re-verified with checkRevoked, which asks Firebase — the issuer
//               — whether this token is still good. That covers a disabled
//               account, a sign-out-everywhere, and a password reset. Adding a
//               caller to a local invalidation function could not have covered
//               any of them.
//   ROLE        read from the database, not from req.collabRole and not from
//               the per-process cache. The row IS the authority.
//
// Both sources are SHARED, so the property holds across instances by
// construction rather than by remembering to invalidate N caches. That is the
// reason this is a read and not a flush.
//
// THE TWO CHECKS ARE INDEPENDENT. Each denies on its own:
//
//   revoked credential + valid role  → 401
//   valid credential  + demoted role → 403
//   valid credential  + valid role   → proceed
//
// AN OUTAGE IS NOT A PERMISSION, AND NOT A DENIAL. An unreachable Firebase or
// database answers 503. Keeping "we could not determine your authority" apart
// from "you do not have it" is the same rule requireCollabRole learned in R11
// (I61), where a swallowed error promoted the caller to the top role.
//
// THE ROLE COMPARISON IS EXACT. `normalizeRole` maps any unrecognised value to
// STRATEGIST so a surface can render something; at this boundary an unknown
// value is a denial. If the WorkspaceRole enum ever grows a member the code
// does not know, the new seat is refused here rather than silently granted the
// highest privilege.
// ============================================================
import admin from '../utils/firebaseAdmin.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/** Firebase error codes that mean "this credential is no longer good". */
const REVOKED_CODES = new Set([
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/id-token-expired',
  'auth/user-not-found',
  'auth/argument-error',
  'auth/invalid-id-token',
]);

function bearerToken(req) {
  const header = req.headers?.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Gate a real-money mutation on authority that is current at this instant.
 *
 * @param {...string} allowed — WORKSPACE_ROLE values permitted on this path.
 */
export function requireFreshAuthority(...allowed) {
  return async function freshAuthorityGate(req, res, next) {
    // ── 1. Is the credential still authoritative? ────────────
    const token = bearerToken(req);
    if (!token) {
      // requireAuth ran before this, so the header was present a moment ago.
      // Reaching here means the chain is wired wrong — refuse rather than skip.
      logger.error({ path: req.path }, '[freshAuthority] no bearer token at the mutation boundary');
      return res.status(401).json({
        error: 'Unauthenticated',
        message: 'This action requires a current credential.',
      });
    }

    try {
      await admin.auth().verifyIdToken(token, true);
    } catch (err) {
      if (REVOKED_CODES.has(err?.code)) {
        logger.warn({ code: err.code, uid: req.userId, path: req.path }, '[freshAuthority] credential no longer valid — denying mutation');
        return res.status(401).json({
          error: 'CredentialRevoked',
          message: 'Your session is no longer valid. Sign in again to continue.',
        });
      }
      // Not a revocation — the issuer could not be asked. That is an outage,
      // and an outage is never a permission.
      logger.error({ err: err?.message, code: err?.code, uid: req.userId, path: req.path }, '[freshAuthority] could not confirm credential — denying');
      return res.status(503).json({
        error: 'AuthorityUnavailable',
        message: 'Could not confirm your session right now. Try again shortly.',
      });
    }

    // ── 2. Is the role still authoritative? ──────────────────
    // The database, never req.collabRole and never the per-process cache.
    let row;
    try {
      row = await prisma.user.findUnique({
        where:  { clerkId: req.userId },
        select: { collabRole: true },
      });
    } catch (err) {
      logger.error({ err: err.message, uid: req.userId, path: req.path }, '[freshAuthority] could not read current role — denying');
      return res.status(503).json({
        error: 'AuthorityUnavailable',
        message: 'Could not confirm your permissions right now. Try again shortly.',
      });
    }

    const current = row?.collabRole ?? null;
    // Exact membership. No normalisation, no default seat.
    if (!current || !allowed.includes(current)) {
      logger.warn({ uid: req.userId, role: current, path: req.path }, '[freshAuthority] role is not permitted on this path — denying mutation');
      return res.status(403).json({
        error:   'RoleForbidden',
        role:    current,
        message: `This action requires one of: ${allowed.join(', ')}.`,
      });
    }

    // Downstream handlers read the CURRENT role, not the one the cache held.
    req.collabRole = current;
    req.authorityFreshAt = Date.now();
    return next();
  };
}
