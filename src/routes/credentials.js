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
import { getProjectById } from '../models/project.js';
import { logger } from '../utils/logger.js';

export const credentialsRouter = Router();

// ── HELPERS ──────────────────────────────────────────────────
async function assertProjectOwnership(userId, projectId, res) {
  if (!projectId) {
    res.status(400).json({ status: 'error', message: 'project_id is required' });
    return false;
  }
  const project = await getProjectById(projectId);
  if (!project) {
    res.status(404).json({ status: 'error', message: 'Project not found' });
    return false;
  }
  if (project.userId !== userId) {
    res.status(403).json({ status: 'error', message: 'Forbidden' });
    return false;
  }
  return true;
}

// ── LIST  GET /api/credentials/:projectId ───────────────────
credentialsRouter.get('/:projectId', async (req, res) => {
  const userId    = req.userId;
  const projectId = req.params.projectId;
  try {
    if (!await assertProjectOwnership(userId, projectId, res)) return;
    const list = await listCredentials(userId, projectId);
    return res.json({ status: 'ok', credentials: list });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId }, '[credentials] list error');
    return res.status(500).json({ status: 'error', message: 'Failed to list credentials' });
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
    if (!await assertProjectOwnership(userId, projectId, res)) return;
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
    return res.status(500).json({ status: 'error', message: 'Failed to save credential' });
  }
});

// ── GET SINGLE  GET /api/credentials/:projectId/:platform ───
// Returns decrypted tokens — only call from trusted server-to-server contexts.
// Frontend should NEVER call this; tokens are only consumed by backend mode handlers.
credentialsRouter.get('/:projectId/:platform', async (req, res) => {
  const userId    = req.userId;
  const { projectId, platform } = req.params;
  try {
    if (!await assertProjectOwnership(userId, projectId, res)) return;
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
    return res.status(500).json({ status: 'error', message: 'Failed to retrieve credential' });
  }
});

// ── DELETE  DELETE /api/credentials/:projectId/:platform ────
credentialsRouter.delete('/:projectId/:platform', async (req, res) => {
  const userId    = req.userId;
  const { projectId, platform } = req.params;
  try {
    if (!await assertProjectOwnership(userId, projectId, res)) return;
    await deleteCredential(userId, projectId, platform);
    return res.json({ status: 'ok' });
  } catch (err) {
    logger.error({ err: err.message, userId, projectId, platform }, '[credentials] delete error');
    return res.status(500).json({ status: 'error', message: 'Failed to delete credential' });
  }
});
