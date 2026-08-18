// ============================================================
// Invitation token lifecycle — capture → carry → confirmed clear (R11 · I58)
// ------------------------------------------------------------
// The token is the membership credential, and it has to survive the hop from
// the invite link to the invited user's FIRST AUTHENTICATED request, because
// that request is where the server claims it. Every case here fails if that
// window is shortened at either end.
//
// The bug this suite pins: the client attached the token to EVERY request and
// dropped it on the first response that came back. Any unauthenticated call
// that happened to fire first — a health probe, a bootstrap fetch on the
// landing page — consumed the client's only copy before signup. Provisioning
// then found no token and fell through to a fresh island workspace: the
// invitation silently became a solo account, with nothing anywhere saying so.
//
// The real inviteToken module and the real sessionStorage are used throughout.
// Mocking the carrier would test the mock, and the carrier IS the defect.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getIdToken, currentUserRef } = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  currentUserRef: { value: null },
}));

// Same override as api.interceptors.test.js: the blanket mock in setup.ts pins
// a permanently signed-in user, and "signed out" is half of what this suite is
// about.
vi.mock('@/firebase', () => ({
  auth: { get currentUser() { return currentUserRef.value; } },
}));

import { api } from './api.js';
import {
  captureInviteTokenFromUrl,
  getInviteToken,
  clearInviteToken,
} from './inviteToken.js';

const STORAGE_KEY = 'lumi.inviteToken';

/**
 * Swap the adapter so nothing leaves the process. `headers` is what the server
 * would have sent back; returns the config axios actually built.
 */
function adapter({ status = 200, headers = {}, data = { ok: true } } = {}) {
  const seen = {};
  api.defaults.adapter = async (config) => {
    Object.assign(seen, config);
    if (status >= 400) {
      const err = new Error(`Request failed with status code ${status}`);
      err.response = { status, data, headers, config };
      err.config = config;
      throw err;
    }
    return { status, data, config, headers };
  };
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearInviteToken();
  getIdToken.mockResolvedValue('tok-123');
  currentUserRef.value = { getIdToken };
  window.history.replaceState({}, '', '/');
});

// ─────────────────────────────────────────────────────────────
describe('capture — the token leaves the URL immediately', () => {
  it('stores the token and strips it from the address bar', () => {
    window.history.replaceState({}, '', '/signup?inviteToken=tok-url&plan=pro');

    const captured = captureInviteTokenFromUrl();

    expect(captured).toBe('tok-url');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('tok-url');
    // A membership credential in the URL is also in the history, in the next
    // Referer header, and in any screenshot of the tab.
    expect(window.location.search).not.toContain('inviteToken');
    expect(window.location.search).not.toContain('tok-url');
  });

  it('preserves the other query parameters, the path and the hash', () => {
    window.history.replaceState({}, '', '/signup?inviteToken=tok-2&plan=pro&ref=x#top');

    captureInviteTokenFromUrl();

    expect(window.location.pathname).toBe('/signup');
    expect(new URLSearchParams(window.location.search).get('plan')).toBe('pro');
    expect(new URLSearchParams(window.location.search).get('ref')).toBe('x');
    expect(window.location.hash).toBe('#top');
  });

  it('replaces rather than pushes — Back cannot return to the tokened URL', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    window.history.replaceState({}, '', '/signup?inviteToken=tok-3');
    replace.mockClear();

    captureInviteTokenFromUrl();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    replace.mockRestore();
    push.mockRestore();
  });

  it('a URL without the param leaves an already-stored token alone', () => {
    sessionStorage.setItem(STORAGE_KEY, 'tok-held');
    window.history.replaceState({}, '', '/app/overview');

    expect(captureInviteTokenFromUrl()).toBe('tok-held');
    expect(getInviteToken()).toBe('tok-held');
  });
});

// ─────────────────────────────────────────────────────────────
describe('carry — only the authenticated provisioning seam gets the token', () => {
  it('an AUTHENTICATED request carries it', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'tok-auth');
    const seen = adapter();

    await api.get('/api/lumi/home');

    expect(seen.headers.Authorization).toBe('Bearer tok-123');
    expect(seen.headers['x-invitation-token']).toBe('tok-auth');
  });

  // ── NC-INV1 · the control ──────────────────────────────────
  it('an UNAUTHENTICATED request does NOT carry it', async () => {
    // The claim happens behind Firebase verification, so an anonymous request
    // could never consume the invitation — it could only burn the client's
    // copy of it on the way back.
    currentUserRef.value = null;
    sessionStorage.setItem(STORAGE_KEY, 'tok-anon');
    const seen = adapter();

    await api.get('/api/health');

    expect(seen.headers.Authorization).toBeUndefined();
    expect(seen.headers['x-invitation-token']).toBeUndefined();
  });

  it('does not carry it when Firebase fails to produce a token', async () => {
    getIdToken.mockRejectedValue(new Error('auth/network-request-failed'));
    sessionStorage.setItem(STORAGE_KEY, 'tok-broken');
    const seen = adapter();

    await api.get('/api/lumi/home');

    expect(seen.headers['x-invitation-token']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('clear — only on the server confirmation', () => {
  // ── NC-INV2 · the control ──────────────────────────────────
  it('a PUBLIC 200 does not clear it', async () => {
    currentUserRef.value = null;
    sessionStorage.setItem(STORAGE_KEY, 'tok-survive');
    adapter();

    await api.get('/api/health');

    expect(getInviteToken()).toBe('tok-survive');
  });

  // ── NC-INV3 · the sharpest control on the clear rule ───────
  it('an AUTHENTICATED 200 without the confirmation header does not clear it', async () => {
    // This is the case a "did the request carry it?" check gets wrong. The
    // token rides on whichever authenticated request happens to be first, and
    // that request may never reach provisioning at all.
    sessionStorage.setItem(STORAGE_KEY, 'tok-not-yet');
    adapter({ headers: {} });

    await api.get('/api/lumi/home');

    expect(getInviteToken()).toBe('tok-not-yet');
  });

  it('clears it when the server CONFIRMS the claim', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'tok-consumed');
    adapter({ headers: { 'x-invitation-claimed': '1' } });

    await api.get('/api/lumi/home');

    expect(getInviteToken()).toBeNull();
  });

  it('a later request no longer carries a consumed token', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'tok-once');
    adapter({ headers: { 'x-invitation-claimed': '1' } });
    await api.get('/api/lumi/home');

    const seen = adapter();
    await api.get('/api/lumi/home');

    expect(seen.headers['x-invitation-token']).toBeUndefined();
  });

  // ── NC-INV4 · the control ──────────────────────────────────
  it('a REFUSED invitation (403) keeps the token — no silent fresh-workspace fallback', async () => {
    // Dropping it here is what produces the downgrade: the retry would arrive
    // with no token, and provisioning would mint a solo island workspace that
    // looks exactly like a normal signup. Keeping it means the refusal repeats
    // loudly and stays actionable.
    sessionStorage.setItem(STORAGE_KEY, 'tok-refused');
    adapter({ status: 403, headers: {}, data: { error: 'INVITATION_INVALID' } });

    await expect(api.get('/api/lumi/home')).rejects.toBeTruthy();

    expect(getInviteToken()).toBe('tok-refused');
  });

  it('a 503 INVITATION_UNAVAILABLE keeps the token — an outage is not a consumption', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'tok-outage');
    adapter({ status: 503, headers: {}, data: { error: 'INVITATION_UNAVAILABLE' } });

    await expect(api.get('/api/lumi/home')).rejects.toBeTruthy();

    expect(getInviteToken()).toBe('tok-outage');
  });
});
