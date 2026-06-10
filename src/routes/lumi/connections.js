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

export const connectionsRouter = Router();

// Tokens are deliberately NOT selected.
const INTEGRATION_DISPLAY_SELECT = Object.freeze({
  platform: true, isActive: true, lastSyncedAt: true, expiresAt: true, metadata: true,
});

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
    const rows = await prisma.integration.findMany({
      where: { workspaceId: wsId },
      select: INTEGRATION_DISPLAY_SELECT,
      orderBy: { platform: 'asc' },
    });
    const now = new Date();
    const connections = rows.map((i) => {
      const health = i.metadata?.health ?? null;
      const lastSuccess = health?.lastSuccessfulSync ?? i.lastSyncedAt ?? null;
      return {
        platform: i.platform,
        isActive: i.isActive,
        connected: i.isActive,
        stale: isStale(lastSuccess, now),
        lastSyncedAt: i.lastSyncedAt ? new Date(i.lastSyncedAt).toISOString() : null,
        accountId: i.metadata?.accountId ?? i.metadata?.customerId ?? null,
        health,
      };
    });
    return res.json({ workspaceId: wsId, connections });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/connections] failed');
    return res.status(500).json({ error: 'ConnectionsUnavailable', message: err.message });
  }
});
