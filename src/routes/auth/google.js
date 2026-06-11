// ============================================================
// MARCOM — Google Ads OAuth Routes  (/api/auth/google/*)
//
// GET /api/auth/google/connect   — Firebase-authenticated (JWT).
//   HMAC-signs (workspaceId, userId) into state, redirects to Google consent.
// GET /api/auth/google/callback  — NOT authenticated (Google redirects here).
//   Verifies state, exchanges code → access+refresh tokens, discovers the
//   accessible customer id, and persists to marcom_credentials KEYED BY WORKSPACE
//   (platform 'google_ads'), so the workspace-scoped connector resolves it.
//
// Mirrors auth/meta.js. The token exchange + customer discovery are live network
// calls — exercised only on a real connect (no creds/network in this env).
// ============================================================
import { Router } from 'express';
import { requireAuth } from '../../middleware/firebaseAuth.js';
import { upsertWorkspaceCredential } from '../../services/connectors/credentialStore.js';
import { buildState, parseState } from './oauthState.js';
import { logger } from '../../utils/logger.js';

// Re-export the pure state helpers (their canonical home is oauthState.js, which
// is Firebase-free so tests can import them without booting Firebase Admin).
export { buildState, parseState } from './oauthState.js';

export const authGoogleRouter = Router();

const CLIENT_ID    = () => process.env.GOOGLE_ADS_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.GOOGLE_ADS_CLIENT_SECRET || '';
const REDIRECT_URI = () => process.env.GOOGLE_REDIRECT_URI
  || `${process.env.APP_BASE_URL || 'https://marcom-marketing-os.onrender.com'}/api/auth/google/callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

// ── CONNECT ──────────────────────────────────────────────────
authGoogleRouter.get('/connect', requireAuth, (req, res) => {
  const workspaceId = req.workspaceId;
  const userId = req.userId;
  if (!workspaceId) return res.status(409).json({ error: 'No resolvable workspace.' });
  if (!CLIENT_ID()) return res.status(503).json({ error: 'GOOGLE_ADS_CLIENT_ID is not configured on this server.' });

  const state = buildState(workspaceId, userId);
  const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(CLIENT_ID())}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI())}`
    + '&response_type=code'
    + `&scope=${encodeURIComponent(SCOPE)}`
    + '&access_type=offline&prompt=consent'
    + `&state=${encodeURIComponent(state)}`;
  logger.info({ workspaceId }, '[google-auth] generated Google OAuth URL');
  return res.json({ oauthUrl });
});

// ── CALLBACK ─────────────────────────────────────────────────
authGoogleRouter.get('/callback', async (req, res) => {
  const { code, state: stateParam, error: oauthError } = req.query;
  if (oauthError) return res.redirect('/app/connections?google_error=denied');

  const stateData = parseState(stateParam || '');
  if (!stateData) return res.redirect('/app/connections?google_error=invalid_state');
  const { workspaceId, userId } = stateData;

  try {
    // Exchange code → tokens (live network).
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECT_URI(), grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || 'token exchange failed');

    // Discover the accessible customer id (live network; best-effort).
    let accountId = null;
    try {
      const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
      const r = await fetch('https://googleads.googleapis.com/v17/customers:listAccessibleCustomers', {
        headers: { Authorization: `Bearer ${tok.access_token}`, 'developer-token': devToken },
      });
      const body = await r.json();
      accountId = (body.resourceNames?.[0] || '').replace('customers/', '') || null;
    } catch (err) {
      logger.warn({ err: err.message }, '[google-auth] could not list customers — saving tokens only');
    }

    await upsertWorkspaceCredential(workspaceId, 'GOOGLE', {
      userId,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      accountId,
      scopes: SCOPE,
      expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
    });
    logger.info({ workspaceId, accountId }, '[google-auth] Google credential saved');
    return res.redirect('/app/connections?google_connected=1');
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[google-auth] callback error');
    return res.redirect('/app/connections?google_error=server_error');
  }
});
