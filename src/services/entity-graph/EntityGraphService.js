// ============================================================
// EntityGraphService — read the connector entity graph for the UI
// ============================================================
// The Campaigns surface's bridge into the entity graph (Campaign → AdSet +
// MetricSnapshot) that live connectors populate via snapshotSink. NOTE: the
// legacy feed (CampaignState, written by CSV upload) is a DIFFERENT, disjoint
// substrate — it carries no ad-set detail. This service exposes the
// connector-synced campaigns (the only substrate with ad-sets) so they become
// drillable. Graph logic lives here, never in the route handler (PR#15+ rule).
//
// No N+1: metrics for a whole level are fetched in one `in` query and reduced
// to latest-per-entity in memory by the pure engine.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { ENTITY_LEVEL } from '../connectors/connectorTypes.js';
import { latestByEntity, toCampaignRow, toAdSetRow } from './entityGraphEngine.js';

// entityId columns are @db.Uuid — a non-UUID string makes Prisma throw on the
// cast (the 500 the feed route documents). Guard before any id-keyed query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_DAYS = Number(process.env.ENTITY_SNAPSHOT_WINDOW_DAYS || 90);

const METRIC_SELECT = {
  entityId: true, date: true, spendMinor: true, roas: true, ctr: true, frequency: true, currency: true,
  conversions: true, // needed for the account-level Blended CPA aggregate (Σspend / Σconversions)
  // The verdict engine rolls up raw totals and re-derives roas/ctr itself, so it
  // needs the un-ratio'd inputs the display projection never used: revenue, the
  // ctr numerator/denominator. Surfaced here (they already exist on the row) so
  // the connector→verdict adapter never has to zero-fill a missing field.
  revenueMinor: true, impressions: true, clicks: true,
};

// Latest snapshot per entity for a level, over a bounded recency window.
async function latestSnapshots(workspaceId, entityLevel, entityIds) {
  if (!entityIds.length) return new Map();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const snaps = await prisma.metricSnapshot.findMany({
    where:  { workspaceId, entityLevel, entityId: { in: entityIds }, date: { gte: since } },
    select: METRIC_SELECT,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, entityLevel }, '[EntityGraph] snapshot read failed');
    return [];
  });
  return latestByEntity(snaps);
}

/**
 * Connector-synced campaigns for the workspace, each with its latest metrics +
 * ad-set count (so the client knows which rows are drillable). Empty array when
 * no connector has synced — the honest "connect a live channel" state upstream.
 */
export async function getConnectorCampaigns(workspaceId) {
  if (!workspaceId) return [];
  const campaigns = await prisma.campaign.findMany({
    where:   { workspaceId },
    select:  { id: true, name: true, channel: true, objective: true, _count: { select: { adSets: true } } },
    orderBy: { createdAt: 'desc' },
    take:    200,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId }, '[EntityGraph] campaigns read failed');
    return [];
  });
  if (!campaigns.length) return [];

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.CAMPAIGN, campaigns.map((c) => c.id));
  return campaigns.map((c) =>
    toCampaignRow({ id: c.id, name: c.name, channel: c.channel, objective: c.objective, adSetCount: c._count.adSets }, metrics.get(c.id)),
  );
}

/**
 * Ad-sets of one campaign (workspace-scoped) with latest metrics.
 * @returns {Promise<Array|null>} rows[] when the campaign exists in this
 * workspace ([] when it has no ad-sets), or null when the campaign isn't found
 * (→ honest 404, never a fabricated empty drill-down).
 */
export async function getCampaignAdSets(workspaceId, campaignEntityId) {
  if (!workspaceId || !UUID_RE.test(String(campaignEntityId || ''))) return null;

  const campaign = await prisma.campaign.findFirst({
    where:  { id: campaignEntityId, workspaceId },
    select: { id: true },
  }).catch(() => null);
  if (!campaign) return null;

  const adSets = await prisma.adSet.findMany({
    where:   { campaignId: campaignEntityId, workspaceId },
    select:  { id: true, name: true, channel: true },
    orderBy: { createdAt: 'asc' },
    take:    500,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, campaignEntityId }, '[EntityGraph] adsets read failed');
    return [];
  });
  if (!adSets.length) return [];

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.ADSET, adSets.map((a) => a.id));
  return adSets.map((a) => toAdSetRow(a, metrics.get(a.id)));
}
