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
import { logger } from '../../utils/logger.js';
import { resolve, isSyncable } from './connectorRegistry.js';
import { landSnapshots } from './snapshotSink.js';
import { listActiveSyncable, recordSync } from './credentialStore.js';

/**
 * Run the connector sync.
 * @param {string|null} workspaceId — a single workspace, or null for all
 * @param {{ datePreset?: string, now?: Date }} [opts]
 */
export async function runConnectorSync(workspaceId = null, { datePreset = 'last_7d', now = new Date() } = {}) {
  const connections = await listActiveSyncable(workspaceId);
  const syncable = connections.filter((c) => isSyncable(c.channel));

  if (syncable.length === 0) {
    logger.info({ workspaceId }, '[connectorSync] no active syncable credentials');
    return { synced: 0, failed: 0, results: [] };
  }

  const results = [];
  for (const conn of syncable) {
    const { workspaceId: wsId, channel } = conn;
    // Per-channel isolation: a throw here is caught, recorded, and the loop continues.
    try {
      const connector = resolve(channel);
      const auth = await connector.authenticate(wsId);
      if (!auth.ok) {
        await recordSync(wsId, channel, { ok: false, error: auth.error, now });
        results.push({ workspaceId: wsId, platform: channel, status: 'skipped', reason: auth.error });
        continue;
      }
      const raw = await connector.fetchRaw(auth, { datePreset });
      const normalized = connector.normalize({ ...auth, date: now, rows: raw });
      const landed = await landSnapshots(wsId, connector.channel, normalized);
      await recordSync(wsId, channel, { ok: true, records: landed.snapshots, now });
      results.push({ workspaceId: wsId, platform: channel, status: 'success', ...landed });
    } catch (err) {
      await recordSync(wsId, channel, { ok: false, error: err.message, now })
        .catch((recordErr) => logger.warn({
          workspaceId: wsId,
          platform: channel,
          err: recordErr.message,
        }, '[connectorSync] failed to record sync failure'));
      logger.error({ workspaceId: wsId, platform: channel, err: err.message }, '[connectorSync] channel failed (isolated)');
      results.push({ workspaceId: wsId, platform: channel, status: 'error', error: err.message });
    }
  }

  const synced = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'error').length;
  logger.info({ workspaceId, synced, failed, total: syncable.length }, '[connectorSync] complete');
  return { synced, failed, results };
}
