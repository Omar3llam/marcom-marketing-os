// ============================================================
// MARCOM / Lumi — where to send someone back to after they sign in
// ------------------------------------------------------------
// ONE mechanism, used by every guard that bounces a visitor to /login, and by
// the login page that reads the result back. Phase 5.1 measured three different
// answers to the same question: /app/* preserved its destination, while /admin
// and /onboarding silently lost theirs — /admin because its fallback redirected
// to Overview first, so the login page only ever saw Overview.
//
// The validation is deliberately a WHITELIST OF SHAPE, not of routes: a new
// destination should not have to be registered here to be restorable. What it
// refuses is an address that does not belong to this app, or one that would
// bounce straight back to the page doing the asking.
// ============================================================

// Sending someone back to the page that sent them to /login is a loop, so these
// are never restorable — the post-auth default takes over instead.
const AUTH_PATHS = ['/login', '/signup'];

/**
 * PURE: is this an internal destination we may return someone to?
 *
 * @param {unknown} value — a candidate path, already URL-DECODED (what
 *   `URLSearchParams.get` hands back). Encoding happens once, in `loginPathFor`.
 * @returns {string|null} the path, or null when it is not restorable
 */
export function safeNextPath(value) {
  if (typeof value !== 'string' || value === '') return null;
  // Must be a path on this origin. `//evil.com` and `/\evil.com` are both read
  // as protocol-relative URLs by browsers, which is how an open redirect starts.
  if (!value.startsWith('/')) return null;
  const second = value.charCodeAt(1);
  if (second === 47 || second === 92) return null; // a second / or a backslash
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;

  // Lower-cased because the ROUTER matches case-insensitively: `/LOGIN` reaches
  // the login page just as `/login` does, so a case-varied spelling would walk
  // straight past a case-sensitive comparison and land the visitor back on the
  // page that sent them — measured against `matchPath`, not assumed.
  const path = value.split(/[?#]/)[0].toLowerCase();
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return value;
}

/** PURE: the address a visitor is standing on, query and hash included. */
export function currentDestination(location) {
  return `${location?.pathname ?? ''}${location?.search ?? ''}${location?.hash ?? ''}`;
}

/**
 * PURE: the login address that remembers where the visitor was going.
 * Encodes EXACTLY ONCE; `safeNextPath` takes decoded input for that reason.
 */
export function loginPathFor(location) {
  const next = safeNextPath(currentDestination(location));
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
