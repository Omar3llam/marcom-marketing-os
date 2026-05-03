// ============================================================
// MARCOM / Lumi — HMAC Quick-Action Link helper (Phase 5)
// ------------------------------------------------------------
// One-click links sent over email/Slack carry no Bearer token,
// so we sign each link with HMAC-SHA256 over the canonical
// payload + an expiry timestamp. The route handler verifies the
// signature, checks the expiry, and only then enqueues the
// referenced Action onto BullMQ.
//
// Token shape (URL-safe base64 of JSON):
//   { aid: <actionId>, exp: <unixSeconds>, scope: 'execute' | 'rollback' }
// Plus a separate `sig` query param: hex HMAC-SHA256 of the
// canonical "<aid>.<exp>.<scope>" string.
// ============================================================
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.QUICK_ACTION_HMAC_SECRET || process.env.JWT_SECRET || '';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;       // 24 h — matches rollback window

function canonical({ aid, exp, scope }) {
  return `${aid}.${exp}.${scope}`;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

export function signQuickAction({ actionId, scope = 'execute', ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!SECRET) throw new Error('QUICK_ACTION_HMAC_SECRET (or JWT_SECRET) not configured');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const aid = actionId;
  const sig = createHmac('sha256', SECRET).update(canonical({ aid, exp, scope })).digest('hex');
  const token = b64url(JSON.stringify({ aid, exp, scope }));
  return { token, sig, expiresAt: new Date(exp * 1000) };
}

export function verifyQuickAction({ token, sig }) {
  if (!SECRET) throw new Error('QUICK_ACTION_HMAC_SECRET (or JWT_SECRET) not configured');
  if (!token || !sig) return { ok: false, reason: 'missing_token_or_sig' };

  let payload;
  try { payload = JSON.parse(b64urlDecode(token)); }
  catch { return { ok: false, reason: 'malformed_token' }; }

  const { aid, exp, scope } = payload;
  if (!aid || !exp || !scope) return { ok: false, reason: 'incomplete_payload' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', SECRET).update(canonical({ aid, exp, scope })).digest();
  const provided = Buffer.from(sig, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true, actionId: aid, scope, expiresAt: new Date(exp * 1000) };
}
