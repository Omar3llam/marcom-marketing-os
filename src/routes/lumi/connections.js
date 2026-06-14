// ============================================================
// MARCOM / Lumi — Connections (Phase 12 · connector status)
//   GET /api/lumi/connections — connected channels + freshness + health.
//
// DISPLAY FIELDS ONLY. A typed select excludes accessToken/refreshToken so
// credentials can never leak into an API response or a log. Read-only.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { isStale } from '../../services/connectors/connectorTypes.js';
import { listConnections } from '../../services/connectors/credentialStore.js';
import { runConnectorSync } from '../../services/connectors/ConnectorSyncService.js';

export const connectionsRouter = Router();

async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/connections] workspaceId fallback failed');
    return null;
  }
}

connectionsRouter.get('/connections', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.json({ workspaceId: null, connections: [] });
  try {
    const rows = await listConnections(wsId); // marcom_credentials display fields — no tokens
    const now = new Date();
    const connections = rows.map((c) => {
      const lastSuccess = c.health?.lastSuccessfulSync ?? c.lastSyncedAt ?? null;
      return {
        platform: c.platform,
        isActive: c.isActive,
        connected: c.isActive,
        stale: isStale(lastSuccess, now),
        lastSyncedAt: c.lastSyncedAt ?? null,
        accountId: c.accountId ?? null,
        health: c.health ?? null,
      };
    });
    return res.json({ workspaceId: wsId, connections });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/connections] failed');
    return res.status(500).json({ error: 'ConnectionsUnavailable', message: 'Request failed' });
  }
});

// POST /api/lumi/connections/sync — manual trigger for the connector sync loop,
// scoped to the caller's workspace. Runs the SAME path as the cron (authenticate
// → fetchRaw → normalize → landSnapshots → recordSync) so the button and the
// scheduler can never drift. Workspace-scoped on purpose: connectors read
// marcom_credentials by workspace_id (the Phase 12c bridge), NOT the legacy
// project-scoped meta_ads credential. Per-channel failures are isolated inside
// the service and surface in `results`, so a single bad channel still returns 200.
connectionsRouter.post('/connections/sync', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(400).json({ error: 'WorkspaceNotFound', message: 'No workspace for this user' });
  try {
    const datePreset = typeof req.body?.datePreset === 'string' ? req.body.datePreset : 'last_30d';
    const result = await runConnectorSync(wsId, { datePreset });
    return res.json({ ok: true, workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/connections/sync] failed');
    return res.status(500).json({ error: 'SyncFailed', message: 'Sync failed' });
  }
});
