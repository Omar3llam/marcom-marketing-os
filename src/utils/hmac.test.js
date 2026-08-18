import { afterEach, describe, expect, it } from 'vitest';
import { signQuickAction, verifyQuickAction } from './hmac.js';

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

const CLAIMS = { actionId: 'action-1', workspaceId: 'ws-1', actorId: 'uid-1' };

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('quick-action HMAC helpers', () => {
  it('signs and verifies with QUICK_ACTION_HMAC_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.QUICK_ACTION_HMAC_SECRET = 'quick-secret';
    delete process.env.JWT_SECRET;

    const signed = signQuickAction(CLAIMS);
    expect(verifyQuickAction(signed)).toMatchObject({
      ok: true,
      actionId: 'action-1',
      workspaceId: 'ws-1',
      actorId: 'uid-1',
      scope: 'execute',
    });
  });

  it('does not fall back to JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.QUICK_ACTION_HMAC_SECRET;
    process.env.JWT_SECRET = 'jwt-secret';

    expect(() => signQuickAction(CLAIMS))
      .toThrow('QUICK_ACTION_HMAC_SECRET is required in production');
  });

  it('allows JWT_SECRET fallback outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.QUICK_ACTION_HMAC_SECRET;
    process.env.JWT_SECRET = 'jwt-secret';

    const signed = signQuickAction({ ...CLAIMS, actionId: 'action-2' });
    expect(verifyQuickAction(signed)).toMatchObject({
      ok: true,
      actionId: 'action-2',
    });
  });
});

// ─────────────────────────────────────────────────────────────
// R11 (I65) — the signature binds the workspace and the actor
// ─────────────────────────────────────────────────────────────
describe('quick-action tokens are workspace- and actor-bound (I65)', () => {
  const secretEnv = () => {
    process.env.NODE_ENV = 'test';
    process.env.QUICK_ACTION_HMAC_SECRET = 'quick-secret';
  };

  it('REFUSES to mint a token that names no workspace or actor', () => {
    secretEnv();
    expect(() => signQuickAction({ actionId: 'a1', actorId: 'u1' })).toThrow(/workspaceId required/);
    expect(() => signQuickAction({ actionId: 'a1', workspaceId: 'w1' })).toThrow(/actorId required/);
  });

  // ── NC-C3 · the control ────────────────────────────────────
  it('REFUSES a token whose workspace was swapped after signing', () => {
    secretEnv();
    const signed = signQuickAction(CLAIMS);
    const claims = JSON.parse(Buffer.from(signed.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    const tampered = { token: b64url({ ...claims, wid: 'ws-someone-else' }), sig: signed.sig };

    expect(verifyQuickAction(tampered)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('REFUSES a token whose actor was swapped after signing', () => {
    secretEnv();
    const signed = signQuickAction(CLAIMS);
    const claims = JSON.parse(Buffer.from(signed.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    const tampered = { token: b64url({ ...claims, act: 'uid-attacker' }), sig: signed.sig };

    expect(verifyQuickAction(tampered)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('REFUSES a token whose scope was escalated after signing', () => {
    secretEnv();
    const signed = signQuickAction({ ...CLAIMS, scope: 'execute' });
    const claims = JSON.parse(Buffer.from(signed.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    const tampered = { token: b64url({ ...claims, scope: 'rollback' }), sig: signed.sig };

    expect(verifyQuickAction(tampered)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('REFUSES a v1 token — the unbound shape is not accepted "for compatibility"', () => {
    secretEnv();
    const v1 = { token: b64url({ aid: 'a1', exp: Math.floor(Date.now() / 1000) + 600, scope: 'execute' }), sig: 'deadbeef' };
    expect(verifyQuickAction(v1)).toMatchObject({ ok: false, reason: 'unsupported_token_version' });
  });

  it('still refuses an expired token and a missing signature', () => {
    secretEnv();
    const expired = signQuickAction({ ...CLAIMS, ttlSeconds: -1 });
    expect(verifyQuickAction(expired)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyQuickAction({ token: expired.token })).toMatchObject({ ok: false, reason: 'missing_token_or_sig' });
  });
});
