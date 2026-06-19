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
import { listConnections, updateCredentialAccount } from '../../services/connectors/credentialStore.js';
import { runConnectorSync } from '../../services/connectors/ConnectorSyncService.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET } from '../../services/connectors/connectorConfig.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

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
        availableAccounts: c.availableAccounts ?? [],
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
connectionsRouter.post('/connections/sync', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(400).json({ error: 'WorkspaceNotFound', message: 'No workspace for this user' });
  try {
    const datePreset = typeof req.body?.datePreset === 'string' ? req.body.datePreset : DEFAULT_MANUAL_SYNC_DATE_PRESET;
    const result = await runConnectorSync(wsId, { datePreset });
    return res.json({ ok: true, workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/connections/sync] failed');
    return res.status(500).json({ error: 'SyncFailed', message: 'Sync failed' });
  }
});

// PATCH /api/lumi/connections/account — switch the ACTIVE ad account for a channel
// without re-running OAuth, then re-sync so the new account's data lands now. The
// auto-pick at connect time is a guess; this is how a user corrects it when the
// token grants more than one ad account. accountId is validated server-side
// against the token's stored availableAccounts — a user can only switch between
// accounts the token already proves access to, never inject an arbitrary id.
// Switching the active ad account changes the workspace's data source — a
// configuration change that belongs to the STRATEGIST/owner, not a buyer seat.
connectionsRouter.patch('/connections/account', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(400).json({ error: 'WorkspaceNotFound', message: 'No workspace for this user' });

  const platform = String(req.body?.platform || '').toUpperCase();
  const accountId = req.body?.accountId == null ? '' : String(req.body.accountId);
  if (!platform || !accountId) {
    return res.status(400).json({ error: 'BadRequest', message: 'platform and accountId are required' });
  }

  try {
    const rows = await listConnections(wsId);
    const target = rows.find((c) => c.platform === platform);
    const allowed = (target?.availableAccounts ?? []).map((a) => String(a.id));
    if (!allowed.includes(accountId)) {
      return res.status(403).json({ error: 'AccountNotAllowed', message: 'That ad account is not associated with the connected token.' });
    }

    const switched = await updateCredentialAccount(wsId, platform, accountId);
    if (!switched) return res.status(404).json({ error: 'ConnectionNotFound', message: 'No active connection for this channel' });

    // Best-effort re-sync: a sync failure must NOT fail the switch — it surfaces as
    // staleness on the next connections read, never a silent corruption.
    let sync = null;
    try {
      sync = await runConnectorSync(wsId, { datePreset: DEFAULT_MANUAL_SYNC_DATE_PRESET });
    } catch (syncErr) {
      logger.warn({ err: syncErr.message, wsId, platform }, '[lumi/connections/account] re-sync after switch failed');
    }
    return res.json({ ok: true, platform, accountId, sync });
  } catch (err) {
    logger.error({ err: err.message, wsId, platform }, '[lumi/connections/account] failed');
    return res.status(500).json({ error: 'AccountSwitchFailed', message: 'Request failed' });
  }
});
