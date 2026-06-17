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
 */
export function toSnapshotRows(workspaceId, channel, normalized = []) {
  return normalized.map((n) => {
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
    const data = { workspaceId, channel, name: n.name || n.externalId, externalId: String(n.externalId), status: 'ACTIVE' };
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

/**
 * Land a normalized batch for one workspace+channel. Idempotent (re-sync upserts
 * in place). Returns counts.
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
        update: { name: op.data.name, status: op.data.status },
      }),
    ),
  );

  const rows = toSnapshotRows(workspaceId, channel, normalized);
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
