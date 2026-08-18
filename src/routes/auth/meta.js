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
import { prisma } from '../../lib/prisma.js';
import { saveCredential } from '../../models/credential.js';
import { attachWorkspaceToCredential } from '../../services/connectors/credentialStore.js';
import { getProject }    from '../../models/project.js';
import {
  exchangeForLongLivedToken,
  listAdAccounts,
} from '../../services/metaAdsService.js';
import { logger } from '../../utils/logger.js';

export const authMetaRouter = Router();

// ── CONFIG ───────────────────────────────────────────────────
const APP_ID       = () => process.env.META_APP_ID     || '';
const REDIRECT_URI = () => process.env.META_REDIRECT_URI
  || `${process.env.APP_BASE_URL || 'https://marcom-marketing-os.onrender.com'}/api/auth/meta/callback`;
const SCOPES       = ['ads_read', 'ads_management'].join(',');
const API_VERSION  = 'v21.0';

// HMAC key — reuse WEBHOOK_SECRET so we don't need a new env var
function hmacKey() {
  const k = process.env.WEBHOOK_SECRET || '';
  if (!k) logger.warn('[meta-auth] WEBHOOK_SECRET not set — state HMAC will be weak');
  return k;
}

// ── STATE HELPERS ────────────────────────────────────────────
// State format (new):  <userId>:<projectId>:<returnTo_base64url>:<timestamp_ms>
// State format (legacy): <userId>:<projectId>:<timestamp_ms>
// MAC is computed over that string and appended as :<mac>. returnTo is base64url
// so its slashes/query chars never collide with the ':' delimiter, and parse
// stays backward compatible with in-flight legacy states (3 payload parts).
export function buildState(userId, projectId, returnTo) {
  const rt      = Buffer.from(returnTo || '').toString('base64url');
  const payload = `${userId}:${projectId}:${rt}:${Date.now()}`;
  const mac     = createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${mac}`).toString('base64url');
}

export function parseState(stateB64) {
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

    // New format carries returnTo at index 2 (ts at 3); legacy has ts at index 2.
    let userId, projectId, returnTo = null, tsStr;
    if (parts.length >= 4) {
      [userId, projectId, , tsStr] = parts;
      returnTo = parts[2] ? Buffer.from(parts[2], 'base64url').toString('utf8') : null;
    } else {
      [userId, projectId, tsStr] = parts;
    }
    const age = Date.now() - parseInt(tsStr, 10);
    if (age > 10 * 60 * 1000) throw new Error('State expired (>10 min)');
    return { userId, projectId, returnTo };
  } catch (err) {
    logger.warn({ err: err.message }, '[meta-auth] Invalid OAuth state');
    return null;
  }
}

// Only same-origin app paths may be an OAuth return target — never an external
// URL (open-redirect) or an arbitrary path. Defaults to the historical Settings.
const ALLOWED_RETURN_PREFIXES = ['/app/', '/onboarding'];
export function safeReturnTo(returnTo) {
  if (typeof returnTo === 'string' && ALLOWED_RETURN_PREFIXES.some((p) => returnTo.startsWith(p))) {
    return returnTo;
  }
  return '/app/settings';
}

// Append query params to a path that may already carry a query string.
function withParams(base, params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  if (!qs) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

// ── CONNECT  GET /api/auth/meta/connect?projectId=xxx ────────
// Returns OAuth URL as JSON for frontend to redirect to.
// This allows the frontend to make an authenticated API call via axios,
// then redirect to the returned URL (avoiding the need to pass tokens in query strings).
authMetaRouter.get('/connect', requireAuth, (req, res, next) => {
  const userId    = req.userId;
  const projectId = req.query.projectId;

  try {
    if (!projectId) {
      logger.warn({ userId }, '[meta-auth] connect rejected: missing projectId');
      return res.status(400).json({ error: 'Missing projectId query parameter.' });
    }
    if (!APP_ID()) {
      logger.error({ userId, projectId }, '[meta-auth] connect unavailable: META_APP_ID missing');
      return res.status(503).json({ error: 'META_APP_ID is not configured on this server.' });
    }

    const state = buildState(userId, projectId, req.query.returnTo);
    const oauthUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth`
      + `?client_id=${encodeURIComponent(APP_ID())}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI())}`
      + `&scope=${encodeURIComponent(SCOPES)}`
      + `&state=${encodeURIComponent(state)}`;

    logger.info({ userId, projectId }, '[meta-auth] Generated Meta OAuth URL');
    return res.json({ oauthUrl });
  } catch (err) {
    logger.error({
      err: err.message,
      stack: err.stack,
      userId,
      projectId,
      path: req.path,
    }, '[meta-auth] connect failed unexpectedly');
    return next(err);
  }
});

// ── CALLBACK  GET /api/auth/meta/callback ────────────────────
// NOT protected by requireAuth — Meta redirects the browser here.
// User identity is recovered from the HMAC-signed state param.
authMetaRouter.get('/callback', async (req, res) => {
  const { code, state: stateParam, error: oauthError, error_description } = req.query;

  // Parse state first so every redirect (incl. denial) can return the user to
  // wherever they started the connect from (onboarding vs Settings).
  const stateData = parseState(stateParam || '');
  const returnTo  = safeReturnTo(stateData?.returnTo);

  // ── User denied the OAuth permission dialog
  if (oauthError) {
    logger.warn({ oauthError, error_description }, '[meta-auth] User denied Meta OAuth');
    return res.redirect(withParams(returnTo, { meta_error: 'denied' }));
  }

  // ── Validate state HMAC (invalid → can't trust returnTo, use the default)
  if (!stateData) {
    return res.redirect('/app/settings?meta_error=invalid_state');
  }
  const { userId, projectId } = stateData;

  // ── Verify project ownership (belt-and-suspenders)
  const project = await getProject(userId, projectId).catch(() => null);
  if (!project) {
    logger.warn({ userId, projectId }, '[meta-auth] Project not found in callback');
    return res.redirect(withParams(returnTo, { meta_error: 'project_not_found' }));
  }

  try {
    // ── Exchange code → short-lived token (1hr)
    const appId     = APP_ID();
    const appSecret = process.env.META_APP_SECRET || '';
    const redirectUri = REDIRECT_URI();

    // R11 (I68) — the app secret and the authorization code travel in the POST
    // body, not the URL. Meta accepts either; only one of them stays out of the
    // access log. Google's callback in this same codebase already POSTed its
    // secret, so the two providers now agree.
    const exchangeUrl = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`;
    const exchangeForm = new URLSearchParams({
      client_id:     appId,
      redirect_uri:  redirectUri,
      client_secret: appSecret,
      code,
    });

    const exchRes  = await fetch(exchangeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    exchangeForm.toString(),
    });
    const exchBody = await exchRes.json();
    if (exchBody.error) throw new Error(exchBody.error.message || 'Code exchange failed');
    const shortToken = exchBody.access_token;

    // ── Exchange short-lived → long-lived (60 days)
    const { accessToken: longToken, expiresAt } = await exchangeForLongLivedToken(shortToken);

    // ── Discover ad accounts — take the first active one
    let adAccountId = null;
    let availableAccounts = [];
    try {
      const accounts = await listAdAccounts(longToken);
      const active   = accounts.filter(a => a.accountStatus === 1); // 1 = ACTIVE
      adAccountId    = (active[0] || accounts[0])?.id || null;
      // Auto-pick is a GUESS — with >1 ad account the first active one may not be
      // the one with delivery. Store every account the token proves access to so
      // the user can switch the active account later without re-running OAuth.
      availableAccounts = accounts.map(a => ({ id: a.id, name: a.name }));
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
      metadata:     availableAccounts.length ? { availableAccounts } : undefined,
    });

    logger.info({ userId, projectId, adAccountId }, '[meta-auth] Meta credential saved');

    // ── Bridge to the workspace-scoped connector world (Phase 12c).
    // Stamp workspace_id on the just-saved project-keyed row so the Meta connector
    // (which resolves by workspace_id) can see it. ADDITIVE — the legacy feed still
    // reads the same row by (project_id, user_id). Best-effort: a user with no
    // Prisma workspace keeps a working feed; the connector simply won't see it yet.
    try {
      const u = await prisma.user.findUnique({ where: { clerkId: userId }, select: { workspaceId: true } });
      if (u?.workspaceId) {
        await attachWorkspaceToCredential({ projectId, userId, platform: 'meta_ads', workspaceId: u.workspaceId });
        logger.info({ userId, projectId, workspaceId: u.workspaceId }, '[meta-auth] stamped workspace on Meta credential');
      } else {
        logger.warn({ userId }, '[meta-auth] no Prisma workspace for user — Meta connector will not see this credential yet');
      }
    } catch (stampErr) {
      logger.warn({ err: stampErr.message, userId }, '[meta-auth] workspace stamp failed (non-fatal — feed unaffected)');
    }

    // ── Redirect back to wherever the connect started (Settings, or onboarding)
    return res.redirect(withParams(returnTo, {
      meta_connected: '1',
      projectId,
      adAccountId: adAccountId || undefined,
    }));
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[meta-auth] Callback error');
    return res.redirect(withParams(returnTo, { meta_error: 'server_error' }));
  }
});
