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
import { DEFAULT_MANUAL_SYNC_DATE_PRESET, isDailyIngestionEnabled, DAILY_STATE } from './connectorConfig.js';
import { CAPABILITY } from './connectorReadiness.js';
import { prisma } from '../../lib/prisma.js';
import { assertWorkspaceLive, isWorkspaceScopeError } from '../../lib/workspaceLiveness.js';

/**
 * Run the connector sync.
 * @param {string|null} workspaceId — a single workspace, or null for all
 * @param {{ datePreset?: string, now?: Date }} [opts]
 */
export async function runConnectorSync(workspaceId = null, { datePreset = DEFAULT_MANUAL_SYNC_DATE_PRESET, now = new Date() } = {}) {
  const connections = await listActiveSyncable(workspaceId);
  const syncable = connections.filter((c) => isSyncable(c.channel));

  if (syncable.length === 0) {
    if (workspaceId) await assertWorkspaceLive(prisma, workspaceId);
    logger.info({ workspaceId }, '[connectorSync] no active syncable credentials');
    return { synced: 0, failed: 0, results: [] };
  }

  const results = [];
  for (const conn of syncable) {
    const { workspaceId: wsId, channel } = conn;
    // Per-channel isolation: a throw here is caught, recorded, and the loop continues.
    try {
      await assertWorkspaceLive(prisma, wsId);
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
          if (isWorkspaceScopeError(err)) throw err;
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
      // STILL OPT-IN, and B4-D turned the deployment's copy of the switch ON.
      // R8 left it off because nothing read the rows — every existing selector
      // filters DAILY out by construction (OPERATIONAL_MEASUREMENT_WINDOWS is an
      // allow-list that names DAILY as excluded on purpose). That is STILL true:
      // B4-D adds no reader.
      //
      // It is on anyway, deliberately, because the ordering only works one way.
      // Nothing can be built to measure an outcome from a population that has
      // never existed — the first consumer would be written against imagined
      // rows and validated against none. Ingestion has to run first so the
      // evidence is real before anything reads it. The cost is one extra Meta
      // request per sync per account, bounded by DAILY_INGESTION_DAYS.
      //
      // BEST-EFFORT, like the canonical refresh: a daily failure degrades to no
      // daily rows for this run. It must never take down the operational sync
      // that every existing surface reads.
      //
      // ── B4-D — the four meanings of `null` ───────────────────────────────
      //
      // R8 reported this population as a single nullable count, and null meant
      // FOUR different things: the deployment has daily off, this connector has
      // no daily path, the fetch threw, or the run landed nothing. An operator
      // enabling the flag and finding no rows could not tell which — and "why is
      // the population empty" is the entire question this activation must answer.
      //
      // So the outcome is now a NAMED STATE beside the count, never derived from
      // it. `dailyObservations` keeps its exact prior semantics (0 = landed
      // nothing, null = no count exists) because it is the shape callers were
      // written against; the state is additive and carries the numbers needed to
      // separate "the account delivered nothing" from "every row was refused".
      let daily = null;
      let dailyState = DAILY_STATE.DISABLED;
      let dailyDetail = { fetchedRows: null, rejected: null, days: null, truncated: null, error: null };

      if (!isDailyIngestionEnabled()) {
        // Not a failure and not an absence of data: nobody asked.
        dailyState = DAILY_STATE.DISABLED;
      } else if (!connector.fetchDailyRaw || !connector.normalizeDaily) {
        // The connector takes part in sync but cannot answer "what happened on
        // each day". Reported as its own state because the fix is to implement a
        // provider, not to investigate an account.
        dailyState = DAILY_STATE.UNIMPLEMENTED;
      } else {
        try {
          const rawDaily = await connector.fetchDailyRaw(auth, { now });
          const { snapshots, rejected } = connector.normalizeDaily({
            ...auth, date: now, rows: rawDaily.rows,
          });
          daily = await landDailySnapshots(wsId, connector.channel, snapshots);
          dailyDetail = {
            // What the platform returned, what the normalizer refused, and how
            // far back we asked. Real counts or null — never a zero standing in
            // for a number nobody produced.
            fetchedRows: Array.isArray(rawDaily.rows) ? rawDaily.rows.length : null,
            rejected: Array.isArray(rejected) ? rejected.length : null,
            days: rawDaily.days ?? null,
            truncated: rawDaily.truncated ?? null,
            error: null,
          };
          // SUCCESS means rows exist for this run. Zero landed rows is NO_DATA —
          // a real, honest outcome, and NOT a failure: an account that did not
          // deliver on any requested day produces exactly this.
          dailyState = (daily.created + daily.restated) > 0 ? DAILY_STATE.SUCCESS : DAILY_STATE.NO_DATA;
          logger.info(
            {
              workspaceId: wsId, platform: channel, days: rawDaily.days,
              ...daily, rejected: dailyDetail.rejected, truncated: rawDaily.truncated,
              dailyState,
            },
            '[connectorSync] daily additive observations landed',
          );
        } catch (err) {
          if (isWorkspaceScopeError(err)) throw err;
          // FAILED, never folded into NO_DATA. "We could not look" and "we looked
          // and there was nothing" are different facts with different fixes.
          dailyState = DAILY_STATE.FAILED;
          dailyDetail = { ...dailyDetail, error: err.message };
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

      // C-04 — the daily outcome is PERSISTED, not just returned. `dailyState`
      // was computed on every run and discarded at the end of it, so the
      // connections read could not tell DISABLED from UNIMPLEMENTED from
      // NO_DATA from FAILED — the four different problems with four different
      // fixes that DAILY_STATE exists to keep apart.
      //
      // Only this call site passes it, and deliberately: the two failure paths
      // above and below never reached the daily branch, so they have no outcome
      // to report and must not overwrite the last one that did.
      // Populations are best effort, but loss of the parent is never success.
      await assertWorkspaceLive(prisma, wsId);
      await recordSync(wsId, channel, {
        ok: true, records: landed.snapshots, warning, now,
        capabilities: { [CAPABILITY.DAILY_OBSERVATIONS]: dailyState },
      });
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
        //
        // UNCHANGED by B4-D on purpose. `daily.state` below is what tells those
        // three apart; this count keeps meaning exactly what it meant, so no
        // existing reader changes behaviour.
        dailyObservations: daily ? daily.created + daily.restated : null,
        // B4-D — the state, and the numbers that qualify it. Present on every
        // result, including the ones where nothing ran.
        daily: {
          state: dailyState,
          created: daily?.created ?? null,
          restated: daily?.restated ?? null,
          skippedUnknownEntity: daily?.skippedUnknownEntity ?? null,
          ...dailyDetail,
        },
        ...(warning ? { warning } : {}),
      });
    } catch (err) {
      if (isWorkspaceScopeError(err)) {
        await recordSync(wsId, channel, { ok: false, error: err.message, now })
          .catch(() => logger.warn({ code: err.code, platform: channel }, '[connectorSync] refusal health unavailable'));
        logger.warn({ code: err.code, platform: channel }, '[connectorSync] workspace scope refused');
        results.push({ workspaceId: wsId, platform: channel, status: 'error', code: err.code, error: err.message });
        continue;
      }
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
