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
import { landDailySnapshots } from './dailySnapshotSink.js';
import { listActiveSyncable, recordSync } from './credentialStore.js';
import { DEFAULT_MANUAL_SYNC_DATE_PRESET, isDailyIngestionEnabled } from './connectorConfig.js';

/**
 * Run the connector sync.
 * @param {string|null} workspaceId — a single workspace, or null for all
 * @param {{ datePreset?: string, now?: Date }} [opts]
 */
export async function runConnectorSync(workspaceId = null, { datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET, now = new Date() } = {}) {
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
      // A connector may override landing (e.g. GA4 lands ACTUALS onto existing
      // entities via actualsSink instead of minting through snapshotSink).
      const landed = connector.land
        ? await connector.land(wsId, normalized)
        : await landSnapshots(wsId, connector.channel, normalized);

      // ── CANONICAL VERDICT REFRESH (Phase F) ────────────────────────────────
      // A SECOND, separate fetch for exactly the canonical 30-day window, run on
      // EVERY sync regardless of which trigger fired or what preset it asked for.
      // That is the whole point: the operational sync above may request
      // `maximum`, `last_90d`, or anything a client puts in the request body, and
      // none of it can change what a verdict measures any more.
      //
      // Two fetches rather than one because the two answer different questions —
      // "refresh the account" vs "measure the decision period" — and folding them
      // together would put the verdict window back under a sync parameter.
      //
      // BEST-EFFORT by construction: a canonical failure degrades to no canonical
      // row for this run, which the resolver reports as NO_CANONICAL_WINDOW. It
      // must never take down the operational sync that every other surface reads.
      let canonical = null;
      if (connector.fetchCanonicalRaw && connector.normalizeCanonical) {
        try {
          const raw30 = await connector.fetchCanonicalRaw(auth, { now });
          const rows30 = connector.normalizeCanonical({
            ...auth, date: now, rows: raw30.rows,
            windowStart: raw30.windowStart, windowEnd: raw30.windowEnd,
          });
          canonical = await landSnapshots(wsId, connector.channel, rows30);
          logger.info(
            { workspaceId: wsId, platform: channel, snapshots: canonical.snapshots },
            '[connectorSync] canonical 30d refresh landed',
          );
        } catch (err) {
          logger.warn(
            { workspaceId: wsId, platform: channel, err: err.message },
            '[connectorSync] canonical 30d refresh failed — verdict rows not refreshed this run',
          );
        }
      }

      // ── DAILY ADDITIVE INGESTION (Phase E / R8) ────────────────────────────
      // A THIRD fetch, and the first one that returns true daily observations
      // (`time_increment=1`). Separate from both reads above for the reason they
      // are separate from each other: it answers a different question — not
      // "refresh the account" and not "measure the decision period", but "what
      // happened on each day".
      //
      // OPT-IN. As of R8 nothing reads this population: every existing selector
      // filters DAILY out by construction (OPERATIONAL_MEASUREMENT_WINDOWS is an
      // allow-list that names DAILY as excluded on purpose). Spending an extra
      // Meta request per sync on rows no consumer reads is a cost, so the switch
      // is off until a reader exists — the same trade SYNC_TRIGGERS_SWEEP makes.
      //
      // BEST-EFFORT, like the canonical refresh: a daily failure degrades to no
      // daily rows for this run. It must never take down the operational sync
      // that every existing surface reads.
      let daily = null;
      if (isDailyIngestionEnabled() && connector.fetchDailyRaw && connector.normalizeDaily) {
        try {
          const rawDaily = await connector.fetchDailyRaw(auth, { now });
          const { snapshots, rejected } = connector.normalizeDaily({
            ...auth, date: now, rows: rawDaily.rows,
          });
          daily = await landDailySnapshots(wsId, connector.channel, snapshots);
          logger.info(
            {
              workspaceId: wsId, platform: channel, days: rawDaily.days,
              ...daily, rejected: rejected.length, truncated: rawDaily.truncated,
            },
            '[connectorSync] daily additive observations landed',
          );
        } catch (err) {
          logger.warn(
            { workspaceId: wsId, platform: channel, err: err.message },
            '[connectorSync] daily additive ingestion failed — no daily rows this run',
          );
        }
      }

      // A connector MAY hang non-enumerable fetch metadata off the raw array
      // (MetaConnector does, for ad-set pagination). A sync that knowingly read
      // only part of an account is not a plain success: it lands real data, but
      // presenting it as complete is the "looks whole, isn't" failure. Recorded
      // as a health WARNING so it is visible in the admin drill-down rather than
      // living only in a log line.
      const warning = raw?.fetchMeta?.truncated
        ? 'Large account: some ad sets were not read this sync (pagination limit). Figures may be incomplete.'
        : null;
      if (warning) {
        logger.warn({ workspaceId: wsId, platform: channel, fetchMeta: raw.fetchMeta }, '[connectorSync] partial fetch');
      }

      await recordSync(wsId, channel, { ok: true, records: landed.snapshots, warning, now });
      results.push({
        workspaceId: wsId, platform: channel, status: 'success', ...landed,
        // Reported separately from `snapshots` so a caller can tell an
        // operational refresh from a verdict refresh. null = this connector has
        // no canonical path, or its canonical fetch failed this run.
        canonicalSnapshots: canonical?.snapshots ?? null,
        // Reported separately again, for the same reason: three populations,
        // three counts. null = daily ingestion is off for this deployment, this
        // connector has no daily path, or its daily fetch failed this run — and a
        // caller must be able to tell those from "zero days landed".
        dailyObservations: daily ? daily.created + daily.restated : null,
        ...(warning ? { warning } : {}),
      });
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
