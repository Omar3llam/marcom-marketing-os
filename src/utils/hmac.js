// ============================================================
// MARCOM / Lumi - HMAC Quick-Action Link helper (Phase 5)
// ------------------------------------------------------------
// One-click links sent over email/Slack carry no Bearer token,
// so we sign each link with HMAC-SHA256 over the canonical
// payload + an expiry timestamp. The route handler verifies the
// signature, checks the expiry, and only then enqueues the
// referenced Action onto BullMQ.
//
// Token shape (URL-safe base64 of JSON):
//   { v: 2, aid: <actionId>, wid: <workspaceId>, act: <actorUserId>,
//     exp: <unixSeconds>, scope: 'execute' | 'rollback' }
// Plus a separate `sig` param: hex HMAC-SHA256 of the canonical
// "v2.<aid>.<wid>.<act>.<exp>.<scope>" string.
//
// R11 (I65) — the signed message now binds the WORKSPACE and the ACTOR.
//
// Before R11 it covered only "<aid>.<exp>.<scope>". Forging it was infeasible,
// but the token said nothing about which tenant the action belonged to or who
// was entitled to press the button: the handler looked the action up globally
// by id, and the enqueue recorded no actor, so the audit trail could not say
// who acted. Binding both means a signature is valid for exactly one action, in
// one workspace, on behalf of one person — and changing any of the three
// invalidates it.
//
// The canonical string is versioned so this change is legible rather than
// silent: a v1 token no longer verifies. That costs nothing today because
// signQuickAction has no production caller yet — the minting side of this
// feature was never wired — so there are no live links to invalidate. If that
// changes, the version prefix is the seam to migrate on.
// ============================================================
import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 h, matches rollback window
const TOKEN_VERSION = 2;

function getQuickActionSecret() {
  if (process.env.QUICK_ACTION_HMAC_SECRET) return process.env.QUICK_ACTION_HMAC_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('QUICK_ACTION_HMAC_SECRET is required in production');
  }
  return process.env.JWT_SECRET || '';
}

function canonical({ aid, wid, act, exp, scope }) {
  return `v${TOKEN_VERSION}.${aid}.${wid}.${act}.${exp}.${scope}`;
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

/**
 * Mint a one-click link token.
 * @param {string} actionId    the Action this link acts on
 * @param {string} workspaceId the workspace that owns it   (R11 · I65)
 * @param {string} actorId     who the link was issued to   (R11 · I65)
 */
export function signQuickAction({ actionId, workspaceId, actorId, scope = 'execute', ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const secret = getQuickActionSecret();
  if (!secret) throw new Error('QUICK_ACTION_HMAC_SECRET (or JWT_SECRET) not configured');
  if (!actionId)    throw new Error('signQuickAction: actionId required');
  if (!workspaceId) throw new Error('signQuickAction: workspaceId required');
  if (!actorId)     throw new Error('signQuickAction: actorId required');

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const claims = { v: TOKEN_VERSION, aid: actionId, wid: workspaceId, act: actorId, exp, scope };
  const sig = createHmac('sha256', secret)
    .update(canonical({ aid: actionId, wid: workspaceId, act: actorId, exp, scope }))
    .digest('hex');
  return { token: b64url(JSON.stringify(claims)), sig, expiresAt: new Date(exp * 1000) };
}

export function verifyQuickAction({ token, sig }) {
  const secret = getQuickActionSecret();
  if (!secret) throw new Error('QUICK_ACTION_HMAC_SECRET (or JWT_SECRET) not configured');
  if (!token || !sig) return { ok: false, reason: 'missing_token_or_sig' };

  let payload;
  try { payload = JSON.parse(b64urlDecode(token)); }
  catch { return { ok: false, reason: 'malformed_token' }; }

  const { v, aid, wid, act, exp, scope } = payload;
  // A v1 token carried no workspace and no actor. Refusing it outright is the
  // point: accepting one "for compatibility" would keep the unbound token valid
  // and make the binding optional, which is not a binding.
  if (v !== TOKEN_VERSION) return { ok: false, reason: 'unsupported_token_version' };
  if (!aid || !wid || !act || !exp || !scope) return { ok: false, reason: 'incomplete_payload' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', secret).update(canonical({ aid, wid, act, exp, scope })).digest();
  const provided = Buffer.from(sig, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return {
    ok: true,
    actionId:    aid,
    workspaceId: wid,
    actorId:     act,
    scope,
    expiresAt: new Date(exp * 1000),
  };
}
