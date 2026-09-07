// ============================================================
// MARCOM / Lumi — starting an OAuth connect
// ------------------------------------------------------------
// FE-04 · extracted from the Connectors view. It was exported from the page
// component, so onboarding's ConnectStep — which needs only this function —
// imported the whole surface: the channel list, useConnections and sonner, all
// pulled into the eagerly-imported onboarding chunk. That is also why
// lazy-routing the destination on its own would not have moved it out of the
// main bundle.
//
// Behaviour is unchanged from the version that shipped. The request itself now
// goes through the feature service (arch-check CHECK 2B — the frontend API
// boundary), so what is left here is the browser navigation, which is not an
// API call and does not belong in a service.
// ============================================================
import { requestOAuthUrl, isConnectable } from './services.js';

/**
 * Returns TRUE only when a redirect was actually initiated. An unknown platform
 * or a response without an oauthUrl used to be a silent no-op — the caller had
 * no way to tell "navigating away" from "nothing happened", and onboarding sat
 * on "Redirecting to Meta…" forever.
 */
export async function startConnect(platform, projectId, returnTo) {
  if (!isConnectable(platform)) return false;
  const oauthUrl = await requestOAuthUrl(platform, projectId, returnTo);
  if (!oauthUrl) return false;
  window.location.href = oauthUrl;
  return true;
}
