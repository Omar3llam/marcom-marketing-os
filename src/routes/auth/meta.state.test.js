import { beforeAll, describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { buildState, parseState, safeReturnTo } from './meta.js';

// R11 (E7) — OAuth state is signed with OAUTH_STATE_SECRET, not WEBHOOK_SECRET,
// and hmacKey() now THROWS when neither is configured rather than signing with
// the empty string. An HMAC keyed on '' is not a signature; it is a checksum
// anyone can compute, and a test that relied on that was asserting round-trip
// mechanics against a key an attacker also has.
//
// So the test supplies the key the code requires. It has to be set before the
// first buildState call, not merely before the assertions.
const TEST_STATE_SECRET = 'r11-test-oauth-state-secret-0123456789abcdef';
beforeAll(() => { process.env.OAUTH_STATE_SECRET = TEST_STATE_SECRET; });
process.env.OAUTH_STATE_SECRET = TEST_STATE_SECRET;

// Re-sign a state with a chosen timestamp (buildState always uses Date.now()).
function signedState(userId, projectId, returnTo, ts) {
  const rt = Buffer.from(returnTo || '').toString('base64url');
  const payload = `${userId}:${projectId}:${rt}:${ts}`;
  const mac = createHmac('sha256', process.env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${mac}`).toString('base64url');
}

describe('meta OAuth state — returnTo threading (PR#266)', () => {
  it('round-trips userId/projectId/returnTo through build → parse', () => {
    const s = buildState('uid_1', 'proj_1', '/onboarding?step=connect');
    expect(parseState(s)).toMatchObject({
      userId: 'uid_1',
      projectId: 'proj_1',
      returnTo: '/onboarding?step=connect',
    });
  });

  it('preserves query chars + slashes in returnTo', () => {
    const rt = '/app/campaigns?x=1&y=2';
    expect(parseState(buildState('u', 'p', rt)).returnTo).toBe(rt);
  });

  it('a missing returnTo parses back as null (userId/projectId intact)', () => {
    const parsed = parseState(buildState('u', 'p'));
    expect(parsed.userId).toBe('u');
    expect(parsed.projectId).toBe('p');
    expect(parsed.returnTo).toBeNull();
  });

  it('a forged state (bad MAC) → null', () => {
    // Hand-crafted payload with a bogus MAC that can't match the HMAC.
    const forged = Buffer.from(`u:p:cmV0:${Date.now()}:deadbeef`).toString('base64url');
    expect(parseState(forged)).toBeNull();
  });

  it('an expired state (>10 min) → null', () => {
    expect(parseState(signedState('u', 'p', '/app/x', Date.now() - 11 * 60 * 1000))).toBeNull();
  });

  it('a fresh signed state still validates (sanity for the helper)', () => {
    expect(parseState(signedState('u', 'p', '/app/x', Date.now()))).toMatchObject({ userId: 'u', returnTo: '/app/x' });
  });

  it('garbage → null', () => {
    expect(parseState('not-a-real-state')).toBeNull();
  });
});

describe('safeReturnTo — open-redirect guard', () => {
  it('allows same-origin app + onboarding paths', () => {
    expect(safeReturnTo('/app/campaigns')).toBe('/app/campaigns');
    expect(safeReturnTo('/onboarding?step=connect')).toBe('/onboarding?step=connect');
  });

  it('rejects external URLs and stray paths → /app/settings', () => {
    expect(safeReturnTo('https://evil.example.com')).toBe('/app/settings');
    expect(safeReturnTo('//evil.example.com')).toBe('/app/settings');
    expect(safeReturnTo('/etc/passwd')).toBe('/app/settings');
    expect(safeReturnTo(null)).toBe('/app/settings');
    expect(safeReturnTo(undefined)).toBe('/app/settings');
  });
});
