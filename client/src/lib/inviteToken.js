// ============================================================
// MARCOM / Lumi — Invitation token carrier  (R11 · I58)
// ------------------------------------------------------------
// The invitation token is the membership credential. `GET /api/team/invite/
// accept?token=…` validates it and redirects to `/signup?inviteToken=…`, but
// the actual JOIN happens on the invited user's FIRST authenticated request —
// after Firebase signup — inside the firebaseAuth provisioning seam.
//
// So the token has to survive that hop. This module captures it out of the
// landing URL and holds it in sessionStorage until a request has carried it;
// api.js replays it as `x-invitation-token`.
//
// Why sessionStorage and not a cookie: the token must reach OUR api client
// explicitly and nothing else. It is scoped to the tab, dies with it, and is
// dropped the moment the server has had a chance to consume it.
//
// This is transport plumbing, not an authorization decision — the server
// validates, claims, and single-uses the token. Nothing here is trusted.
// ============================================================

const STORAGE_KEY = 'lumi.inviteToken';

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Safari private mode / storage disabled — degrade to "no token".
    return null;
  }
}

/**
 * Pull `?inviteToken=` out of the current URL and remember it.
 * Safe to call repeatedly; a URL without the param leaves any stored token
 * alone (the user may navigate before signing up).
 */
export function captureInviteTokenFromUrl() {
  if (typeof window === 'undefined' || !window.location) return null;
  try {
    const token = new URLSearchParams(window.location.search).get('inviteToken');
    if (!token) return getInviteToken();
    storage()?.setItem(STORAGE_KEY, token);
    return token;
  } catch {
    return null;
  }
}

/** The pending invitation token, if this tab is mid-invite. */
export function getInviteToken() {
  try {
    return storage()?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Drop the token once a request has carried it to the server. */
export function clearInviteToken() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

// Capture at module load so the token is held no matter which entry point the
// invited user lands on. api.js imports this module, and api.js is on the boot
// path of every surface.
captureInviteTokenFromUrl();
