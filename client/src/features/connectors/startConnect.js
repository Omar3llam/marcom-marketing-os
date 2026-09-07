// ============================================================
// MARCOM / Lumi — starting an OAuth connect
// ------------------------------------------------------------
// FE-04 · extracted from the Connectors view UNCHANGED. It was exported from
// the page component, so onboarding's ConnectStep — which needs only this
// function — imported the whole surface: the channel list, useConnections and
// sonner, all pulled into the eagerly-imported onboarding chunk. That is also
// why lazy-routing the destination on its own would not have moved it out of
// the main bundle.
//
// Behaviour is byte-identical to the version that shipped; only its address
// changed. The rules it encodes are platform facts, not preferences:
//   • Meta connect is PROJECT-scoped (the route 400s without ?projectId).
//   • Google connect is WORKSPACE-scoped (no projectId).
// The old Settings flow passed projectId — without it the connect silently
// no-ops.
// ============================================================
import { api } from '@/lib/api.js';

export const CONNECT_PATH = { GOOGLE: '/api/auth/google/connect', META: '/api/auth/meta/connect' };

// `returnTo` (optional) is the app path the OAuth callback should send the browser
// back to — Meta threads it through the signed state. Onboarding passes its own
// step so the full-page redirect lands back in the flow, not in Settings.
// Returns TRUE only when a redirect was actually initiated. An unknown platform
// or a response without an oauthUrl used to be a silent no-op — the caller had
// no way to tell "navigating away" from "nothing happened", and onboarding sat
// on "Redirecting to Meta…" forever. Throws on transport/HTTP failure as before.
export async function startConnect(platform, projectId, returnTo) {
  const path = CONNECT_PATH[platform];
  if (!path) return false;
  const params = {};
  if (platform === 'META' && projectId) params.projectId = projectId;
  if (returnTo) params.returnTo = returnTo;
  const res = await api.get(path, Object.keys(params).length ? { params } : undefined);
  if (!res.data?.oauthUrl) return false;
  window.location.href = res.data.oauthUrl;
  return true;
}
