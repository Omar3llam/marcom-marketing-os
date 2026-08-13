// ============================================================
// BlendedTruthService — persistence wrapper for the engine
// ============================================================
// Owns DB I/O (the deterministic blendedTruthEngine never touches it).
// Loads recent MetricSnapshots and groups them per channel, splitting
// each channel's rows by source into platform-claimed vs actual
// (GA4/Shopify) revenue, then feeds the engine. Read-only — no writes.
//
// A "channel" here = the entity the snapshots hang off (account/campaign):
// platform and actual rows for the same channel share the same entityId
// and differ only by `source`.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { reconcile } from './blendedTruthEngine.js';
import { isStale, OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';
import { listConnections } from '../connectors/credentialStore.js';
import { TEMPORAL } from '../../config/temporal.js';

export const PLATFORM_SOURCES = Object.freeze(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
// MANUAL = a manually-uploaded revenue actual (CSV). It reconciles as an ACTUAL
// (measured truth), never a platform claim — so a non-pixel account's uploaded
// revenue shows an honest platform-vs-actual gap, not a collapsed-to-zero one.
export const ACTUAL_SOURCES   = Object.freeze(['GA4', 'SHOPIFY', 'MANUAL']);

// Bounds MetricSnapshot.date — the SYNC timestamp, not a delivery horizon.
// Value unchanged (30). See config/temporal.js.
const SYNC_RECENCY_DAYS = TEMPORAL.blendedTruthSyncRecencyDays;

/** A missing/unparseable date sorts oldest — it must never win a comparison. */
function stamp(d) {
  const t = d == null ? NaN : new Date(d).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Collapse MetricSnapshot rows to the newest row per measurement stream.
 *
 * A snapshot row is a TRAILING-WINDOW AGGREGATE stamped with its sync date, not
 * a daily observation: MetaConnector calls normalize({ date = new Date() }) and
 * asks Meta for `date_preset: last_90d | maximum` with NO `time_increment`. So
 * two rows for one entity a day apart both contain the same historical spend,
 * and ADDING THEM COUNTS IT TWICE — over a 30-day lookback, ~30 times.
 *
 * A "stream" is one measurement source for one entity: (entityId, source).
 *   - WITHIN a stream, the newest row supersedes every older one. Same window,
 *     re-measured; only the last reading is current.
 *   - ACROSS streams (a META row and a GA4 row on the same campaign) the rows
 *     are independent measurements of different things. This function leaves
 *     them alone; how to combine them stays the caller's decision.
 *
 * entityLevel is not part of the key because it is already inside entityId —
 * detId(workspaceId, channel, entityLevel, externalId) — so one entityId can
 * only ever carry one level.
 *
 * Order-independent on purpose, so no caller has to remember an `orderBy`.
 * A tie on `date` inside one stream is unreachable: the natural key is
 * (entityId, entityLevel, date, granularity, source) and all three writers —
 * snapshotSink, actualsSink, RevenueCsvService — hardcode granularity DAILY.
 * The first-wins tie-break below therefore cannot fire in production; it exists
 * so a malformed fixture degrades instead of throwing.
 *
 * NOTE: this repairs the arithmetic under the CURRENT snapshot semantics. It
 * does not make the rows daily and must not be read as if it had.
 *
 * @param {Array<object>} snapshots — MetricSnapshot rows
 * @returns {Array<object>} one row per (entityId, source), the newest
 */
export function latestPerStream(snapshots = []) {
  const newest = new Map();
  for (const s of snapshots) {
    const key = `${s.entityId}|${s.source}`;
    const prev = newest.get(key);
    if (prev === undefined || stamp(s.date) > stamp(prev.date)) newest.set(key, s);
  }
  return [...newest.values()];
}

/**
 * Pure: fold raw MetricSnapshot rows into per-channel engine inputs.
 * Exported for unit testing without a DB.
 *
 * Rows are reduced to the newest per stream FIRST (see latestPerStream) — the
 * accumulation below then runs at most once per source per entity, so what it
 * really does is combine an entity's distinct sources, never re-add the same
 * window twice.
 *
 * @param {Array<object>} snapshots — MetricSnapshot rows
 * @param {Map<string,{name,channel,currency}>} [labelsById] — entity metadata
 * @returns {Array<{channelId, channel, platformRevenueMinor, actualRevenueMinor, spendMinor, currency}>}
 */
export function buildChannelInputs(snapshots, labelsById = new Map()) {
  const byChannel = new Map();
  for (const s of latestPerStream(snapshots)) {
    const key = s.entityId;
    if (!byChannel.has(key)) {
      const meta = labelsById.get(key) || {};
      byChannel.set(key, {
        channelId: key,
        channel:   meta.channel ?? null,
        name:      meta.name ?? null,
        currency:  meta.currency ?? s.currency ?? 'USD',
        spendMinor: 0,
        platformRevenueMinor: 0,
        actualRevenueMinor: null, // stays null unless an actual row is seen
      });
    }
    const row = byChannel.get(key);
    if (ACTUAL_SOURCES.includes(s.source)) {
      row.actualRevenueMinor = (row.actualRevenueMinor ?? 0) + (s.revenueMinor ?? 0);
    } else {
      row.platformRevenueMinor += s.revenueMinor ?? 0;
      row.spendMinor           += s.spendMinor ?? 0;
    }
  }
  return [...byChannel.values()];
}

/**
 * Reconcile platform-claimed vs actual revenue for a workspace.
 * @returns {Promise<{ channels, portfolio }>} BlendedTruthEngine output
 */
export async function getBlendedTruth(workspaceId, { lookbackDays = SYNC_RECENCY_DAYS } = {}) {
  if (!workspaceId) throw new Error('getBlendedTruth: workspaceId required');

  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const [snapshots, campaigns] = await Promise.all([
    // Explicit select, not `SELECT *` — a new MetricSnapshot column would
    // otherwise widen this untouched query and break it during migration lag.
    // buildChannelInputs reads exactly these six fields; `date` is what lets it
    // pick the newest row per stream instead of summing overlapping windows.
    prisma.metricSnapshot.findMany({
      // OPERATIONAL ONLY (Phase G). PR #357 made this read latest-per-stream
      // rather than SUM, which fixed overlapping ROLLING_WINDOW rows; it does not
      // help when two rows share entityId, source AND `date`, which is exactly
      // what Phase F produces. The window filter is what separates them — the
      // latest-per-stream reduction stays as #357 left it.
      where:  { workspaceId, date: { gte: since }, measurementWindow: OPERATIONAL_WINDOW_FILTER },
      select: { entityId: true, date: true, source: true, revenueMinor: true, spendMinor: true, currency: true },
    }),
    // Snapshots are CAMPAIGN-grain: MetricSnapshot.entityId == Campaign.id (both are
    // detId(ws, channel, CAMPAIGN, externalId) — see snapshotSink). Key the label map
    // off Campaign.id so the row shows a real name, not the raw detId UUID. The
    // Account-keyed map missed on every campaign-grain row (channel/name → null).
    prisma.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true, channel: true } }),
  ]);

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
  // currency still comes from the workspace (unchanged) — this fix touches labels only.
  const labelsById = new Map(campaigns.map((c) => [c.id, { name: c.name, channel: c.channel, currency: ws?.currency }]));

  const channels = buildChannelInputs(snapshots, labelsById);
  if (channels.length === 0) {
    return { channels: [], portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 0, platformRoas: 0, blendedRoas: 0, reconciledCount: 0, unverifiedCount: 0 } };
  }

  const result = reconcile({ channels });

  // Staleness honesty (Phase 12): surface per-channel freshness from the
  // connector's health WITHOUT touching the reconciled numbers. A channel synced
  // long ago (or whose last sync FAILED) is flagged so the panel never renders a
  // confident gap over mixed-freshness inputs. Keyed off lastSuccessfulSync.
  const conns = await listConnections(workspaceId); // marcom_credentials, channel-keyed, no tokens
  const freshnessByPlatform = new Map(
    conns.map((c) => {
      const lastSuccess = c.health?.lastSuccessfulSync ?? c.lastSyncedAt ?? null;
      return [String(c.platform).toUpperCase(), { lastSuccessfulSync: lastSuccess, lastSyncedAt: c.lastSyncedAt ?? null }];
    }),
  );
  const now = new Date();
  let hasStale = false;
  for (const ch of result.channels) {
    const f = ch.channel ? freshnessByPlatform.get(String(ch.channel).toUpperCase()) : null;
    // Staleness only applies to channels a connector actually tracks. Non-connector
    // data (seed/CSV with no Integration) is not "stale" — we can't claim freshness
    // about it, so we don't flag it.
    const stale = f ? isStale(f.lastSuccessfulSync, now) : false;
    ch.stale = stale;
    ch.lastSyncedAt = f?.lastSyncedAt ? new Date(f.lastSyncedAt).toISOString() : null;
    if (stale) hasStale = true;
  }
  result.portfolio.hasStale = hasStale;

  logger.info({ workspaceId, channels: result.channels.length, gapPct: result.portfolio.gapPct, hasStale }, '[BlendedTruthService] reconciled');
  return result;
}
