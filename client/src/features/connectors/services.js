// ============================================================
// MARCOM / Lumi — Connectors · feature services
// ------------------------------------------------------------
// FE-04. The surface used to live in `client/src/pages/`, where it called the
// shared api client directly. Moving it to a destination under `features/`
// brings it under arch-check CHECK 2B — the frontend API boundary — which
// requires every call from `app/`, `features/`, `design-system/` and
// `components/layout/` to go through a feature service and `@/api/client`.
//
// The rule caught this the moment the file moved, which is the rule working:
// the boundary is about WHERE a surface lives, and this one changed layers.
// Nothing about the requests themselves changed.
// ============================================================
import { api } from '@/api/client';

// Kick the OAuth flow for a platform. Meta connect is PROJECT-scoped (the route
// 400s without ?projectId); Google connect is WORKSPACE-scoped (no projectId).
// The old Settings flow passed projectId — without it the connect silently
// no-ops.
export const CONNECT_PATH = { GOOGLE: '/api/auth/google/connect', META: '/api/auth/meta/connect' };

/** Can this platform be connected at all? Distinguishes a built connector from
 *  one that honestly reads "soon" on the surface. */
export function isConnectable(platform) {
  return Boolean(CONNECT_PATH[platform]);
}

/**
 * Ask the backend for a consent URL. Returns null when the platform is unknown
 * or the response carries no url — the caller needs to tell "navigating away"
 * from "nothing happened", which a thrown error would not distinguish either.
 * Throws on transport/HTTP failure, as before.
 *
 * `returnTo` (optional) is the app path the OAuth callback should send the
 * browser back to — Meta threads it through the signed state. Onboarding passes
 * its own step so the full-page redirect lands back in the flow, not in Settings.
 */
export async function requestOAuthUrl(platform, projectId, returnTo) {
  const path = CONNECT_PATH[platform];
  if (!path) return null;
  const params = {};
  if (platform === 'META' && projectId) params.projectId = projectId;
  if (returnTo) params.returnTo = returnTo;
  const res = await api.get(path, Object.keys(params).length ? { params } : undefined);
  return res.data?.oauthUrl ?? null;
}

/** Switch the ACTIVE ad account for a channel. The server validates accountId
 *  against the token's stored availableAccounts and re-syncs, so a user can only
 *  move between accounts the token already proves access to. */
export async function switchAdAccount(platform, accountId) {
  return api.patch('/api/lumi/connections/account', { platform, accountId });
}
