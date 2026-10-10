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
import { completeMetaOAuthCredential, listConnections, resolveCredential } from '../../services/connectors/credentialStore.js';
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

// R11 (E7) — OAuth state is signed with OAUTH_STATE_SECRET, not the webhook
// secret. Reusing WEBHOOK_SECRET "so we don't need a new env var" put webhook
// authentication and OAuth-state signing in one trust domain: a leak in either
// forged the other, and rotation broke both at once. Required at boot in
// production; falls back in development so a local checkout still works, and
// throws rather than signing with the empty string.
function hmacKey() {
  const k = process.env.OAUTH_STATE_SECRET
    || (process.env.NODE_ENV !== 'production' ? process.env.WEBHOOK_SECRET : '');
  if (!k) {
    logger.error('[meta-auth] OAUTH_STATE_SECRET is not configured — refusing to sign or verify OAuth state');
    throw new Error('OAUTH_STATE_SECRET not configured');
  }
  return k;
}

// ── STATE HELPERS ────────────────────────────────────────────
// PO-approved rollout: legacy unbound states must restart (maximum age 10min).
// v2 signs the full issuance context; it NEVER proves continuing permission.
export function buildState(userId, projectId, returnTo, workspaceId) {
  if (![userId, projectId, workspaceId].every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error('OAuth state requires identity, project and workspace');
  }
  const payload = 'v2.' + Buffer.from(JSON.stringify({
    userId, projectId, workspaceId, returnTo: safeReturnTo(returnTo), issuedAt: Date.now(),
  })).toString('base64url');
  const mac     = createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export function parseState(stateB64) {
  try {
    if (typeof stateB64 !== 'string' || stateB64.length > 8192) throw new Error('Bad state');
    const parts = stateB64.split('.');
    if (parts.length !== 3 || parts[0] !== 'v2' || !/^[A-Za-z0-9_-]+$/.test(parts[1])
      || !/^[a-f0-9]{64}$/.test(parts[2])) throw new Error('Unbound or malformed state');
    const payload = parts.slice(0, 2).join('.');
    const mac = parts[2];
    const expected = createHmac('sha256', hmacKey()).update(payload).digest('hex');
    // Timing-safe comparison
    const a = Buffer.from(mac,      'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('State HMAC mismatch');

    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (![data.userId, data.projectId, data.workspaceId].every((id) => typeof id === 'string' && id.length > 0)
      || typeof data.returnTo !== 'string' || !Number.isSafeInteger(data.issuedAt)) throw new Error('Incomplete state');
    const age = Date.now() - data.issuedAt;
    if (age < 0 || age > 10 * 60 * 1000) throw new Error('State time invalid');
    return { userId: data.userId, projectId: data.projectId, workspaceId: data.workspaceId, returnTo: safeReturnTo(data.returnTo) };
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
  const target = new URL(base, 'http://localhost');
  // An earlier callback flag in returnTo must not outrank this attempt's result.
  target.searchParams.delete('meta_connected');
  target.searchParams.delete('meta_error');
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') target.searchParams.set(key, value);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

// ── CONNECT  GET /api/auth/meta/connect?projectId=xxx ────────
// Returns OAuth URL as JSON for frontend to redirect to.
// This allows the frontend to make an authenticated API call via axios,
// then redirect to the returned URL (avoiding the need to pass tokens in query strings).
authMetaRouter.get('/connect', requireAuth, async (req, res, next) => {
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

    let user, project, workspace;
    try {
      user = await prisma.user.findUnique({ where: { clerkId: userId }, select: { collabRole: true, workspaceId: true } });
      if (user?.collabRole !== 'STRATEGIST' || !user.workspaceId) {
        return res.status(403).json({ error: 'RoleForbidden', message: 'A current workspace Strategist must connect Meta.' });
      }
      [project, workspace] = await Promise.all([
        getProject(userId, projectId),
        prisma.workspace.findUnique({ where: { id: user.workspaceId }, select: { id: true } }),
      ]);
    } catch {
      return res.status(503).json({ error: 'AuthorityUnavailable', message: 'Could not confirm connection permissions. Try again shortly.' });
    }
    if (!project || !workspace) return res.status(403).json({ error: 'RoleForbidden', message: 'No authorized project and workspace.' });
    const state = buildState(userId, projectId, req.query.returnTo, user.workspaceId);
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
  const { code, state: stateParam, error: oauthError } = req.query;

  // Parse state first so every redirect (incl. denial) can return the user to
  // wherever they started the connect from (onboarding vs Settings).
  const stateData = parseState(stateParam || '');
  const returnTo  = safeReturnTo(stateData?.returnTo);

  // ── User denied the OAuth permission dialog
  if (oauthError) {
    logger.warn('[meta-auth] User denied Meta OAuth');
    return res.redirect(withParams(returnTo, { meta_error: 'denied' }));
  }

  // ── Validate state HMAC (invalid → can't trust returnTo, use the default)
  if (!stateData) {
    return res.redirect('/app/settings?meta_error=invalid_state');
  }
  const { userId, projectId, workspaceId } = stateData;

  // ── Verify project ownership (belt-and-suspenders)
  let project;
  try { project = await getProject(userId, projectId); }
  catch { return res.redirect(withParams(returnTo, { meta_error: 'authority_unavailable' })); }
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
    } catch {
      logger.warn({ userId, projectId }, '[meta-auth] Could not list ad accounts — saving token only');
    }

    // No token-only retention: incomplete discovery must not replace a live source.
    if (!longToken || !adAccountId) return res.redirect(withParams(returnTo, { meta_error: 'incomplete_connection' }));
    // Current workspace/user/project authority and ALL writes share one transaction.
    const linked = await completeMetaOAuthCredential({
      userId, projectId, workspaceId,
      accessToken:  longToken,
      accountId:    adAccountId,
      scopes:       SCOPES,
      expiresAt,
      metadata:     availableAccounts.length ? { availableAccounts } : undefined,
    });

    logger.info({ userId, projectId, adAccountId }, '[meta-auth] Meta credential saved');

    // Reader failure AFTER commit is not rollback; never undo a newer connection.
    if (linked?.stamped !== true) throw new Error('OAuth workspace link incomplete');
    const [connections, credential] = await Promise.all([
      listConnections(workspaceId), resolveCredential(workspaceId, 'META'),
    ]);
    const visible = connections.some((c) => c.platform === 'META' && c.isActive && c.accountId === adAccountId);
    if (!visible || !credential?.accessToken || !credential.accountId
      || credential.accessToken !== longToken || credential.accountId !== adAccountId) {
      throw new Error('OAuth workspace connection unreadable');
    }
    logger.info({ userId, projectId, workspaceId }, '[meta-auth] workspace connection complete');

    // ── Redirect back to wherever the connect started (Settings, or onboarding)
    return res.redirect(withParams(returnTo, {
      meta_connected: '1',
      projectId,
      adAccountId: adAccountId || undefined,
    }));
  } catch (err) {
    logger.error({ userId, projectId }, '[meta-auth] Callback completion failed');
    const failures = ['role_forbidden', 'authority_unavailable', 'workspace_unavailable', 'workspace_mismatch', 'project_not_found', 'incomplete_connection'];
    return res.redirect(withParams(returnTo, { meta_error: failures.includes(err?.code) ? err.code : 'server_error' }));
  }
});
