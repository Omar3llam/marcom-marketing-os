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

function hmacKey() {
  const k = process.env.WEBHOOK_SECRET || '';
  if (!k) logger.warn('[oauth-state] WEBHOOK_SECRET not set — state HMAC will be weak');
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
