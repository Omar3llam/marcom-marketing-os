// ============================================================
// snapshotSink — the first real ingestion sink (was seed-only)
// ============================================================
// Lands NormalizedSnapshot[] into the EXISTING graph: upserts Account→Campaign→
// AdSet→Ad (deterministic ids so a re-sync is idempotent) then upserts the
// MetricSnapshot rows by their natural unique key. No engine touches this; every
// downstream engine already reads MetricSnapshot. Before this, that substrate
// existed only in seed.js.
//
// Determinism makes it cheap + safe: entity ids are derived from
// (workspaceId, channel, level, externalId), so `toSnapshotRows` computes each
// snapshot's entityId WITHOUT a DB lookup — no N+1. Entity + snapshot upserts
// each run as one $transaction(map).
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { detId, ENTITY_LEVEL, PARENT_LEVEL } from './connectorTypes.js';

const LEVEL_ORDER = [ENTITY_LEVEL.ACCOUNT, ENTITY_LEVEL.CAMPAIGN, ENTITY_LEVEL.ADSET, ENTITY_LEVEL.AD, ENTITY_LEVEL.CREATIVE];

// level → { prisma model accessor, the parent FK field } (null FK at ACCOUNT).
const LEVEL_MODEL = Object.freeze({
  ACCOUNT:  { model: 'account',  fk: null },
  CAMPAIGN: { model: 'campaign', fk: 'accountId' },
  ADSET:    { model: 'adSet',    fk: 'campaignId' },
  AD:       { model: 'ad',       fk: 'adSetId' },
  CREATIVE: { model: 'creative', fk: 'adId' },
});

const round = (n) => Math.round(n);

/**
 * PURE: NormalizedSnapshot[] → MetricSnapshot create-data rows. entityId is the
 * deterministic id of the entity (no DB lookup). The definitional ratios
 * (cpaMinor/ctr/roas) are derived HERE — one place — so connectors stay dumb.
 * Mirrors prisma/seed.js#snapshot().
 *
 * Roster-only rows (no delivery data found) are EXCLUDED here: they land as
 * entities (toEntityOps keeps them, so the campaign still appears in the list)
 * but never as a MetricSnapshot, so the UI shows "—" (unknown), never a
 * fabricated 0 — and an empty fetch can't overwrite real metrics with zeros.
 */
export function toSnapshotRows(workspaceId, channel, normalized = []) {
  return normalized.filter((n) => !n.rosterOnly).map((n) => {
    const entityId = detId(workspaceId, channel, n.entityLevel, n.externalId);
    const spendMinor = round(n.spendMinor || 0);
    const revenueMinor = round(n.revenueMinor || 0);
    const conversions = n.conversions ?? 0;
    const impressions = n.impressions ?? 0;
    const clicks = n.clicks ?? 0;
    return {
      workspaceId,
      entityId,
      entityLevel: n.entityLevel,
      date: n.date instanceof Date ? n.date : new Date(n.date),
      source: n.source,
      granularity: 'DAILY',
      spendMinor,
      revenueMinor,
      cpaMinor: conversions > 0 ? round(spendMinor / conversions) : null,
      impressions,
      clicks,
      conversions: round(conversions),
      ctr: impressions > 0 ? clicks / impressions : null,
      // ROAS only when there's a positive revenue signal. Meta now requests
      // action_values (see CAMPAIGN_INSIGHT_FIELDS), so revenue flows through for
      // accounts with purchase tracking. But revenue 0 against real spend stays
      // ambiguous — "measured no purchases" vs "no purchase pixel configured" —
      // and the platform can't tell those apart. So we still land null (renders
      // "—"), never a fabricated 0.00x; a real positive value flows through here
      // unchanged.
      roas: spendMinor > 0 && revenueMinor > 0 ? revenueMinor / spendMinor : null,
      frequency: n.frequency ?? null,
      reach: n.reach ?? null, // null-when-absent (Google / unreported), never a fabricated 0
      currency: n.currency || 'USD',
    };
  });
}

/** PURE: the entity-graph upsert descriptors (one per distinct entity). */
export function toEntityOps(workspaceId, channel, normalized = []) {
  const seen = new Set();
  const ops = [];
  for (const n of normalized) {
    const key = `${n.entityLevel}:${n.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = detId(workspaceId, channel, n.entityLevel, n.externalId);
    const spec = LEVEL_MODEL[n.entityLevel];
    const data = { workspaceId, channel, name: n.name || n.externalId, externalId: String(n.externalId) };
    // Delivery status is stamped ONLY when the connector actually resolved one.
    // It used to be hardcoded 'ACTIVE' here and re-written on every update, so a
    // paused campaign asserted it was running and the diagnosis engine had no
    // way to know otherwise. Absent → the create falls to the schema default and
    // the update leaves the stored value alone (same rule as `objective`).
    if (n.status != null) data.status = n.status;
    // objective is a CAMPAIGN-only attribute (the column lives on Campaign, not
    // the other entity models) — only stamp it there, or the Account/AdSet upsert
    // would throw on an unknown arg.
    if (n.entityLevel === ENTITY_LEVEL.CAMPAIGN) data.objective = n.objective ?? null;
    if (spec.fk) {
      const parentLevel = PARENT_LEVEL[n.entityLevel];
      data[spec.fk] = detId(workspaceId, channel, parentLevel, n.parentExternalId);
    }
    ops.push({ level: n.entityLevel, model: spec.model, id, data });
  }
  // Parents first so FKs resolve.
  ops.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  return ops;
}

const DAY_MS = 86_400_000;

// A snapshot's identity for the same-day guard: one positive row per entity per
// UTC calendar day is enough to protect that entity's day from a later zero.
export function snapshotDayKey({ entityId, date }) {
  const d = date instanceof Date ? date : new Date(date);
  return `${entityId}|${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * PURE: drop any incoming zero-spend row that would shadow a same-day positive.
 * `positiveDayKeys` is the set of snapshotDayKey()s that already have spend > 0.
 * A genuinely-zero row with no same-day positive still lands; a positive row is
 * never dropped. (Same-day only: a legitimately new-day zero must be free to land
 * and become the latest — this guards against a bad/empty fetch, not real change.)
 */
export function dropShadowingZeros(rows, positiveDayKeys) {
  if (!positiveDayKeys || positiveDayKeys.size === 0) return rows;
  return rows.filter((r) => !(r.spendMinor === 0 && positiveDayKeys.has(snapshotDayKey(r))));
}

const startOfUtcDay = (ms) => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// Defensive net (any connector / any cause): a zero-spend snapshot must never
// shadow a real positive one for the same entity on the same day. One batched
// read (no N+1); a read failure degrades to the unguarded upsert (Fix 2 already
// makes the roster case safe, so this is belt-and-suspenders, never load-bearing
// for correctness of the common path).
async function guardZeroShadows(workspaceId, rows) {
  const zeros = rows.filter((r) => r.spendMinor === 0);
  if (zeros.length === 0) return rows; // common path: nothing to guard, no query
  try {
    const times = zeros.map((r) => (r.date instanceof Date ? r.date : new Date(r.date)).getTime());
    const dayStart = startOfUtcDay(Math.min(...times));
    const dayEnd = new Date(startOfUtcDay(Math.max(...times)).getTime() + DAY_MS);
    const existing = await prisma.metricSnapshot.findMany({
      where: {
        workspaceId,
        entityId: { in: zeros.map((r) => r.entityId) },
        date: { gte: dayStart, lt: dayEnd },
        spendMinor: { gt: 0 },
      },
      select: { entityId: true, date: true },
    });
    const positiveDayKeys = new Set(existing.map(snapshotDayKey));
    const guarded = dropShadowingZeros(rows, positiveDayKeys);
    if (guarded.length < rows.length) {
      logger.warn(
        { workspaceId, dropped: rows.length - guarded.length },
        '[snapshotSink] refused to shadow same-day positive spend with a zero snapshot',
      );
    }
    return guarded;
  } catch (err) {
    logger.warn({ workspaceId, err: err.message }, '[snapshotSink] zero-shadow guard skipped (read failed)');
    return rows;
  }
}

/**
 * Land a normalized batch for one workspace+channel. Idempotent (re-sync upserts
 * in place). Returns counts. Roster-only rows land as entities but not snapshots
 * (see toSnapshotRows); a zero never shadows a same-day positive (guardZeroShadows).
 */
export async function landSnapshots(workspaceId, channel, normalized = []) {
  if (!workspaceId) throw new Error('landSnapshots: workspaceId required');
  if (!normalized.length) return { entities: 0, snapshots: 0 };

  const entityOps = toEntityOps(workspaceId, channel, normalized);
  await prisma.$transaction(
    entityOps.map((op) =>
      prisma[op.model].upsert({
        where: { id: op.id },
        create: { id: op.id, ...op.data },
        // Only overwrite objective/status when the new value is KNOWN — a later
        // roster/short-window sync that lacks one must never clobber a
        // previously-resolved value. `status` was unconditionally overwritten
        // with the hardcoded 'ACTIVE', so a paused entity was re-activated on
        // every single sync. Objective is absent for non-campaign ops.
        update: {
          name: op.data.name,
          ...(op.data.status != null ? { status: op.data.status } : {}),
          ...(op.data.objective != null ? { objective: op.data.objective } : {}),
        },
      }),
    ),
  );

  const rows = await guardZeroShadows(workspaceId, toSnapshotRows(workspaceId, channel, normalized));
  await prisma.$transaction(
    rows.map((r) =>
      prisma.metricSnapshot.upsert({
        where: {
          entityId_entityLevel_date_granularity_source: {
            entityId: r.entityId, entityLevel: r.entityLevel, date: r.date, granularity: r.granularity, source: r.source,
          },
        },
        create: r,
        update: r,
      }),
    ),
  );

  logger.info({ workspaceId, channel, entities: entityOps.length, snapshots: rows.length }, '[snapshotSink] landed');
  return { entities: entityOps.length, snapshots: rows.length };
}
