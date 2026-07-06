// ============================================================
// MARCOM — Credentials Router  (/api/credentials)
// Stores / retrieves encrypted OAuth tokens for ad platforms.
// All routes are scoped to the authenticated user (req.userId).
// ============================================================
import { Router } from 'express';
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
} from '../models/credential.js';
import { assertProjectOwnership } from '../models/project.js';
import { logger } from '../utils/logger.js';

export const credentialsRouter = Router();

// Deliberate 4xx errors (err.statusCode set, e.g. the 404 ownership throw)
// keep their message — it is user feedback. Unexpected 500s must NOT echo
// err.message (internal detail leak); the caller gets the generic fallback,
// the full error stays in the log line above each call site.
function errBody(err, fallback) {
  const statusCode = err.statusCode ?? 500;
  return {
    statusCode,
    body: {
      status: 'error',
      message: statusCode < 500 ? (err.message || fallback) : fallback,
    },
  };
}

// ── STATUS  GET /api/credentials/status?projectId=&platform= ─
// Quick connectivity check — returns { connected: true/false }.
// Used by the frontend to decide which campaign UI state to show.
credentialsRouter.get('/status', async (req, res) => {
  const userId    = req.userId;
  const { projectId, platform = 'meta_ads' } = req.query;
  if (!projectId) {
    return res.status(400).json({ status: 'error', message: 'projectId is required' });
  }
  try {
    // SECURITY: Throws 404 if user doesn't own project (prevents IDOR)
    await assertProjectOwnership(projectId, userId);
    const cred = await getCredential(userId, projectId, platform);
    return res.json({
      status:    'ok',
      connected: !!cred,
      platform,
      accountId: cred?.accountId ?? null,
      expiresAt: cred?.expiresAt ?? null,
    });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[credentials] status error');
    const { statusCode, body } = errBody(err, 'Failed to check credential status');
    return res.status(statusCode).json(body);
  }
});

// ── LIST  GET /api/credentials/:projectId ───────────────────
credentialsRouter.get('/:projectId', async (req, res) => {
  const userId    = req.userId;
  const projectId = req.params.projectId;
  try {
    // SECURITY: Throws 404 if user doesn't own project (prevents IDOR)
    await assertProjectOwnership(projectId, userId);
    const list = await listCredentials(userId, projectId);
    return res.json({ status: 'ok', credentials: list });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[credentials] list error');
    const { statusCode, body } = errBody(err, 'Failed to list credentials');
    return res.status(statusCode).json(body);
  }
});

// ── UPSERT  POST /api/credentials ───────────────────────────
// Body: { project_id, platform, access_token, refresh_token, account_id, scopes, expires_at }
credentialsRouter.post('/', async (req, res) => {
  const userId = req.userId;
  const {
    project_id:    projectId,
    platform,
    access_token:  accessToken,
    refresh_token: refreshToken,
    account_id:    accountId,
    scopes,
    expires_at:    expiresAtRaw,
  } = req.body;

  if (!platform) {
    return res.status(400).json({ status: 'error', message: 'platform is required' });
  }
  try {
    // SECURITY: Throws 404 if user doesn't own project (prevents IDOR)
    await assertProjectOwnership(projectId, userId);
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : undefined;
    const saved = await saveCredential(userId, {
      projectId, platform, accessToken, refreshToken, accountId, scopes, expiresAt,
    });
    // Never return decrypted tokens in the response body
    const { accessToken: _a, refreshToken: _r, ...safe } = saved;
    return res.json({ status: 'ok', credential: safe });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId, platform }, '[credentials] save error');
    if (err.message.includes('CREDENTIAL_ENCRYPTION_KEY')) {
      return res.status(503).json({ status: 'error', message: 'Credential encryption is not configured on this server.' });
    }
    const { statusCode, body } = errBody(err, 'Failed to save credential');
    return res.status(statusCode).json(body);
  }
});

// ── GET SINGLE  GET /api/credentials/:projectId/:platform ───
// Returns decrypted tokens — only call from trusted server-to-server contexts.
// Frontend should NEVER call this; tokens are only consumed by backend mode handlers.
credentialsRouter.get('/:projectId/:platform', async (req, res) => {
  const userId    = req.userId;
  const { projectId, platform } = req.params;
  try {
    // SECURITY: Throws 404 if user doesn't own project (prevents IDOR)
    await assertProjectOwnership(projectId, userId);
    const cred = await getCredential(userId, projectId, platform);
    if (!cred) {
      return res.status(404).json({ status: 'error', message: 'Credential not found' });
    }
    // Redact tokens — the frontend has no business seeing raw OAuth tokens.
    // This endpoint exists primarily to confirm a credential IS connected.
    const { accessToken: _a, refreshToken: _r, ...safe } = cred;
    return res.json({ status: 'ok', credential: { ...safe, connected: true } });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId, platform }, '[credentials] get error');
    const { statusCode, body } = errBody(err, 'Failed to retrieve credential');
    return res.status(statusCode).json(body);
  }
});

// ── DELETE  DELETE /api/credentials/:projectId/:platform ────
credentialsRouter.delete('/:projectId/:platform', async (req, res) => {
  const userId    = req.userId;
  const { projectId, platform } = req.params;
  try {
    // SECURITY: Throws 404 if user doesn't own project (prevents IDOR)
    await assertProjectOwnership(projectId, userId);
    await deleteCredential(userId, projectId, platform);
    return res.json({ status: 'ok' });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId, platform }, '[credentials] delete error');
    const { statusCode, body } = errBody(err, 'Failed to delete credential');
    return res.status(statusCode).json(body);
  }
});
