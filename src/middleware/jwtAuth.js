// ============================================================
// MARCOM / Lumi — JWT Auth Middleware (Phase 2)
// ------------------------------------------------------------
// Replaces Clerk's session cookie middleware with a stateless
// Bearer-token check. Two verification paths run in order:
//
//   1. Lumi-issued HS256 token — verified against JWT_SECRET.
//      `sub` is interpreted directly as the internal User.id (UUID).
//
//   2. Legacy Clerk RS256 token — verified against Clerk's JWKS
//      endpoint (CLERK_JWKS_URL). `sub` is a Clerk subject
//      (e.g. "user_2abc..."). It is mapped to the internal
//      User.id via the `User.clerkId` column added in Phase 1.
//
// On success the request is decorated with:
//   req.userId       — internal UUID (User.id)
//   req.workspaceId  — User.workspaceId
//   req.userRole     — UserRole enum
//   req.authSource   — 'lumi' | 'clerk'
//
// Failures return 401 { error: 'Unauthenticated', reason }.
// ============================================================
import jwt        from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET    = process.env.JWT_SECRET;
const JWT_ISSUER    = process.env.JWT_ISSUER   || 'lumi-api';
const JWT_AUDIENCE  = process.env.JWT_AUDIENCE || 'lumi-clients';
const CLERK_JWKS    = process.env.CLERK_JWKS_URL || null;

// ── JWKS client (lazy) ───────────────────────────────────────
let _jwks = null;
function getJwks() {
  if (_jwks || !CLERK_JWKS) return _jwks;
  _jwks = jwksClient({
    jwksUri:        CLERK_JWKS,
    cache:          true,
    cacheMaxEntries: 5,
    cacheMaxAge:     10 * 60 * 1000,   // 10 min
    rateLimit:       true,
  });
  return _jwks;
}

function getClerkSigningKey(header, callback) {
  const client = getJwks();
  if (!client) return callback(new Error('CLERK_JWKS_URL not configured'));
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// ── Per-request user cache (resolves clerkId once per request) ──
async function resolveUserFromSub(sub, source) {
  if (source === 'lumi') {
    // sub IS the internal UUID
    return prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, workspaceId: true, role: true },
    });
  }
  // Clerk path — sub looks like "user_2abc..."
  return prisma.user.findUnique({
    where: { clerkId: sub },
    select: { id: true, workspaceId: true, role: true },
  });
}

// ── Verifiers ────────────────────────────────────────────────
function verifyLumi(token) {
  return new Promise((resolve, reject) => {
    if (!JWT_SECRET) return reject(new Error('JWT_SECRET not configured'));
    jwt.verify(
      token,
      JWT_SECRET,
      { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      (err, payload) => err ? reject(err) : resolve(payload),
    );
  });
}

function verifyClerk(token) {
  return new Promise((resolve, reject) => {
    if (!CLERK_JWKS) return reject(new Error('CLERK_JWKS_URL not configured'));
    jwt.verify(
      token,
      getClerkSigningKey,
      { algorithms: ['RS256'] },
      (err, payload) => err ? reject(err) : resolve(payload),
    );
  });
}

// ── Public middleware ────────────────────────────────────────
export async function requireJwt(req, res, next) {
  const hdr = req.headers.authorization || '';
  const m   = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Unauthenticated', reason: 'missing_bearer' });
  }
  const token = m[1].trim();

  let payload, source;
  try {
    payload = await verifyLumi(token);
    source  = 'lumi';
  } catch (lumiErr) {
    if (!CLERK_JWKS) {
      logger.debug({ err: lumiErr.message }, '[jwtAuth] lumi verify failed; no clerk fallback configured');
      return res.status(401).json({ error: 'Unauthenticated', reason: 'invalid_token' });
    }
    try {
      payload = await verifyClerk(token);
      source  = 'clerk';
    } catch (clerkErr) {
      logger.debug({ lumi: lumiErr.message, clerk: clerkErr.message }, '[jwtAuth] both verifiers failed');
      return res.status(401).json({ error: 'Unauthenticated', reason: 'invalid_token' });
    }
  }

  // Resolve sub → internal User row
  const sub = payload.sub;
  if (!sub) {
    return res.status(401).json({ error: 'Unauthenticated', reason: 'missing_sub' });
  }

  let user;
  try {
    user = await resolveUserFromSub(sub, source);
  } catch (err) {
    logger.error({ err: err.message, sub, source }, '[jwtAuth] user lookup failed');
    return res.status(503).json({ error: 'AuthBackendUnavailable' });
  }

  if (!user) {
    return res.status(401).json({
      error:  'Unauthenticated',
      reason: source === 'clerk' ? 'clerk_user_not_provisioned' : 'unknown_user',
    });
  }

  req.userId      = user.id;
  req.workspaceId = user.workspaceId;
  req.userRole    = user.role;
  req.authSource  = source;
  req.jwtPayload  = payload;
  next();
}

// ── Convenience: role gate ───────────────────────────────────
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.userRole || !allowed.includes(req.userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
