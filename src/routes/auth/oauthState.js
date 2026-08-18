// ============================================================
// MARCOM — OAuth state HMAC helpers (PURE)
//
// Extracted from auth/google.js so they can be imported WITHOUT pulling in
// firebaseAuth → firebaseAdmin (which throws at import when no service-account
// env is set, e.g. CI / unit tests). These are pure crypto: no Firebase, no DB.
//
// State wire format: <workspaceId>:<userId>:<ts>:<mac>, base64url.
// ============================================================
import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger.js';

const STATE_TTL_MS = 10 * 60 * 1000;

// ── R11 (E7) — a key of this trust domain's own ──────────────
//
// This used to read WEBHOOK_SECRET, chosen at the time so no new env var was
// needed. That made one key authenticate two unrelated things: inbound n8n
// webhooks, and the OAuth state that carries a userId and workspaceId through
// a redirect the browser controls. A leak in either domain forges the other,
// and rotating for one breaks the other in the same instant.
//
// OAUTH_STATE_SECRET is required at boot in production (config.js), which also
// refuses it if it merely equals WEBHOOK_SECRET. Development falls back so a
// local checkout still works, and the empty case now THROWS rather than warning
// and signing with '': an HMAC keyed on the empty string is not a signature, it
// is a checksum anyone can compute.
function hmacKey() {
  const k = process.env.OAUTH_STATE_SECRET
    || (process.env.NODE_ENV !== 'production' ? process.env.WEBHOOK_SECRET : '');
  if (!k) {
    logger.error('[oauth-state] OAUTH_STATE_SECRET is not configured — refusing to sign or verify OAuth state');
    throw new Error('OAUTH_STATE_SECRET not configured');
  }
  return k;
}

export function buildState(workspaceId, userId) {
  const payload = `${workspaceId}:${userId}:${Date.now()}`;
  const mac = createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${mac}`).toString('base64url');
}

export function parseState(stateB64) {
  try {
    const parts = Buffer.from(stateB64, 'base64url').toString('utf8').split(':');
    if (parts.length < 4) throw new Error('bad state parts');
    const mac = parts.pop();
    const payload = parts.join(':');
    const expected = createHmac('sha256', hmacKey()).update(payload).digest('hex');
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('state HMAC mismatch');
    const [workspaceId, userId, tsStr] = parts;
    if (Date.now() - parseInt(tsStr, 10) > STATE_TTL_MS) throw new Error('state expired');
    return { workspaceId, userId };
  } catch (err) {
    logger.warn({ err: err.message }, '[oauth-state] invalid OAuth state');
    return null;
  }
}
