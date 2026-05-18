// ============================================================
// MARCOM — Meta OAuth Routes  (/api/auth/meta/*)
//
// GET /api/auth/meta/connect   — Firebase-authenticated (JWT).
//   Encodes userId + projectId into an HMAC-signed state param,
//   then redirects the browser to the Meta OAuth consent screen.
//
// GET /api/auth/meta/callback  — NOT Firebase-authenticated.
//   Meta redirects here with ?code=&state=. We verify the HMAC
//   state, exchange the code for a long-lived token, discover the
//   user's ad accounts, and persist everything to marcom_credentials.
// ============================================================
import { Router }   from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireAuth } from '../../middleware/firebaseAuth.js';
import { saveCredential } from '../../models/credential.js';
import { getProject }    from '../../models/project.js';
import {
  exchangeForLongLivedToken,
  listAdAccounts,
} from '../../services/metaAdsService.js';
import { logger } from '../../utils/logger.js';

export const authMetaRouter = Router();

// ── CONFIG ───────────────────────────────────────────────────
const APP_ID       = () => process.env.META_APP_ID     || '';
const REDIRECT_URI = () => process.env.META_REDIRECT_URI || '';
const SCOPES       = ['ads_read', 'ads_management'].join(',');
const API_VERSION  = 'v21.0';

// HMAC key — reuse WEBHOOK_SECRET so we don't need a new env var
function hmacKey() {
  const k = process.env.WEBHOOK_SECRET || '';
  if (!k) logger.warn('[meta-auth] WEBHOOK_SECRET not set — state HMAC will be weak');
  return k;
}

// ── STATE HELPERS ────────────────────────────────────────────
// State format:  <userId>:<projectId>:<timestamp_ms>
// MAC is computed over that string and appended as :<mac>

function buildState(userId, projectId) {
  const payload = `${userId}:${projectId}:${Date.now()}`;
  const mac     = createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${mac}`).toString('base64url');
}

function parseState(stateB64) {
  try {
    const decoded = Buffer.from(stateB64, 'base64url').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length < 4) throw new Error('Bad state parts');
    const mac     = parts.pop();
    const payload = parts.join(':');
    const expected = createHmac('sha256', hmacKey()).update(payload).digest('hex');
    // Timing-safe comparison
    const a = Buffer.from(mac,      'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('State HMAC mismatch');
    const [userId, projectId, tsStr] = parts;
    const age = Date.now() - parseInt(tsStr, 10);
    if (age > 10 * 60 * 1000) throw new Error('State expired (>10 min)');
    return { userId, projectId };
  } catch (err) {
    logger.warn({ err: err.message }, '[meta-auth] Invalid OAuth state');
    return null;
  }
}

// ── CONNECT  GET /api/auth/meta/connect?projectId=xxx ────────
// Returns OAuth URL as JSON for frontend to redirect to.
// This allows the frontend to make an authenticated API call via axios,
// then redirect to the returned URL (avoiding the need to pass tokens in query strings).
authMetaRouter.get('/connect', requireAuth, (req, res) => {
  const userId    = req.userId;
  const projectId = req.query.projectId;

  if (!projectId) {
    return res.status(400).json({ error: 'Missing projectId query parameter.' });
  }
  if (!APP_ID()) {
    return res.status(503).json({ error: 'META_APP_ID is not configured on this server.' });
  }
  if (!REDIRECT_URI()) {
    return res.status(503).json({ error: 'META_REDIRECT_URI is not configured on this server.' });
  }

  const state = buildState(userId, projectId);
  const oauthUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth`
    + `?client_id=${encodeURIComponent(APP_ID())}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI())}`
    + `&scope=${encodeURIComponent(SCOPES)}`
    + `&state=${encodeURIComponent(state)}`;

  logger.info({ userId, projectId }, '[meta-auth] Generated Meta OAuth URL');
  return res.json({ oauthUrl });
});

// ── CALLBACK  GET /api/auth/meta/callback ────────────────────
// NOT protected by requireAuth — Meta redirects the browser here.
// User identity is recovered from the HMAC-signed state param.
authMetaRouter.get('/callback', async (req, res) => {
  const { code, state: stateParam, error: oauthError, error_description } = req.query;

  // ── User denied the OAuth permission dialog
  if (oauthError) {
    logger.warn({ oauthError, error_description }, '[meta-auth] User denied Meta OAuth');
    return res.redirect('/app.html?meta_error=denied');
  }

  // ── Validate state HMAC
  const stateData = parseState(stateParam || '');
  if (!stateData) {
    return res.redirect('/app.html?meta_error=invalid_state');
  }
  const { userId, projectId } = stateData;

  // ── Verify project ownership (belt-and-suspenders)
  const project = await getProject(userId, projectId).catch(() => null);
  if (!project) {
    logger.warn({ userId, projectId }, '[meta-auth] Project not found in callback');
    return res.redirect('/app.html?meta_error=project_not_found');
  }

  try {
    // ── Exchange code → short-lived token (1hr)
    const appId     = APP_ID();
    const appSecret = process.env.META_APP_SECRET || '';
    const redirectUri = REDIRECT_URI();

    const exchangeUrl = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
      + `?client_id=${encodeURIComponent(appId)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&code=${encodeURIComponent(code)}`;

    const exchRes  = await fetch(exchangeUrl);
    const exchBody = await exchRes.json();
    if (exchBody.error) throw new Error(exchBody.error.message || 'Code exchange failed');
    const shortToken = exchBody.access_token;

    // ── Exchange short-lived → long-lived (60 days)
    const { accessToken: longToken, expiresAt } = await exchangeForLongLivedToken(shortToken);

    // ── Discover ad accounts — take the first active one
    let adAccountId = null;
    try {
      const accounts = await listAdAccounts(longToken);
      const active   = accounts.filter(a => a.accountStatus === 1); // 1 = ACTIVE
      adAccountId    = (active[0] || accounts[0])?.id || null;
      logger.info({ userId, projectId, accountCount: accounts.length, adAccountId }, '[meta-auth] Ad accounts discovered');
    } catch (err) {
      logger.warn({ err: err.message }, '[meta-auth] Could not list ad accounts — saving token only');
    }

    // ── Persist to marcom_credentials
    await saveCredential(userId, {
      projectId,
      platform:     'meta_ads',
      accessToken:  longToken,
      accountId:    adAccountId,
      scopes:       SCOPES,
      expiresAt,
    });

    logger.info({ userId, projectId, adAccountId }, '[meta-auth] Meta credential saved');

    // ── Redirect back to app with success flag
    return res.redirect(
      `/app.html?meta_connected=1&projectId=${encodeURIComponent(projectId)}`
      + (adAccountId ? `&adAccountId=${encodeURIComponent(adAccountId)}` : '')
    );
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[meta-auth] Callback error');
    return res.redirect(`/app.html?meta_error=server_error`);
  }
});
