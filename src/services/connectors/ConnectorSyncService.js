// ============================================================
// ConnectorSyncService — the connector-driven sync loop
// ============================================================
// The third cron loop (Agentic · Observer · Connector Sync). For each ACTIVE,
// syncable Integration: resolve the connector, authenticate, fetchRaw, normalize,
// land snapshots, record health. PER-CHANNEL FAILURE ISOLATION — one channel
// failing (or one workspace) never blocks the others; the failure is recorded in
// that channel's health and surfaced as staleness, never silently corrupting
// blended truth.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { resolve, isSyncable } from './connectorRegistry.js';
import { landSnapshots } from './snapshotSink.js';
import { recordSyncHealth } from './connectorHealth.js';

/**
 * Run the connector sync.
 * @param {string|null} workspaceId — a single workspace, or null for all
 * @param {{ datePreset?: string, now?: Date }} [opts]
 */
export async function runConnectorSync(workspaceId = null, { datePreset = 'last_7d', now = new Date() } = {}) {
  const where = { isActive: true, ...(workspaceId ? { workspaceId } : {}) };
  const integrations = await prisma.integration.findMany({ where });
  const syncable = integrations.filter((i) => isSyncable(i.platform));

  if (syncable.length === 0) {
    logger.info({ workspaceId }, '[connectorSync] no active syncable integrations');
    return { synced: 0, failed: 0, results: [] };
  }

  const results = [];
  for (const integ of syncable) {
    // Per-channel isolation: a throw here is caught, recorded, and the loop continues.
    try {
      const connector = resolve(integ.platform);
      const auth = await connector.authenticate(integ.workspaceId);
      if (!auth.ok) {
        await recordSyncHealth(integ, { ok: false, error: auth.error, now });
        results.push({ workspaceId: integ.workspaceId, platform: integ.platform, status: 'skipped', reason: auth.error });
        continue;
      }
      const raw = await connector.fetchRaw(auth, { datePreset });
      const normalized = connector.normalize({ ...auth, date: now, rows: raw });
      const landed = await landSnapshots(integ.workspaceId, connector.channel, normalized);
      await recordSyncHealth(integ, { ok: true, records: landed.snapshots, now });
      results.push({ workspaceId: integ.workspaceId, platform: integ.platform, status: 'success', ...landed });
    } catch (err) {
      await recordSyncHealth(integ, { ok: false, error: err.message, now }).catch(() => {});
      logger.error({ workspaceId: integ.workspaceId, platform: integ.platform, err: err.message }, '[connectorSync] channel failed (isolated)');
      results.push({ workspaceId: integ.workspaceId, platform: integ.platform, status: 'error', error: err.message });
    }
  }

  const synced = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'error').length;
  logger.info({ workspaceId, synced, failed, total: syncable.length }, '[connectorSync] complete');
  return { synced, failed, results };
}
