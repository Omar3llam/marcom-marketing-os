// ============================================================
// MARCOM / Lumi — Invitation token carrier  (R11 · I58)
// ------------------------------------------------------------
// The invitation token is the membership credential. `GET /api/team/invite/
// accept?token=…` validates it and redirects to `/signup?inviteToken=…`, but
// the actual JOIN happens on the invited user's FIRST authenticated request —
// after Firebase signup — inside the firebaseAuth provisioning seam.
//
// So the token has to survive that hop. This module captures it out of the
// landing URL and holds it in sessionStorage until the server confirms the
// claim; api.js replays it as `x-invitation-token` on AUTHENTICATED requests
// only, because only those can reach the provisioning seam.
//
// Why sessionStorage and not a cookie: the token must reach OUR api client
// explicitly and nothing else. It is scoped to the tab and dies with it.
//
// It is dropped only when the server CONFIRMS the claim (the
// `x-invitation-claimed` response header), never merely because a response
// came back — see api.js.
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
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('inviteToken');
    if (!token) return getInviteToken();
    storage()?.setItem(STORAGE_KEY, token);
    stripTokenFromUrl(params);
    return token;
  } catch {
    return null;
  }
}

/**
 * Take the token out of the visible URL as soon as it is captured.
 *
 * A membership credential in the address bar is also in the browser history,
 * in the next Referer header, in a pasted "here's the link" message, and in
 * any screenshot of the tab. sessionStorage already holds it, so the URL copy
 * is exposure with no remaining purpose.
 *
 * replaceState, not pushState: it rewrites the entry in place, so Back cannot
 * walk the user onto the URL that still carries the token. Other query
 * parameters and the hash are preserved.
 */
function stripTokenFromUrl(params) {
  try {
    if (typeof window.history?.replaceState !== 'function') return;
    params.delete('inviteToken');
    const query = params.toString();
    const url   = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* history unavailable (sandboxed iframe) — the token is stored either way */
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
