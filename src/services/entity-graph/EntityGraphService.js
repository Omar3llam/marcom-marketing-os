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
import { effectiveByEntity, toCampaignRow, toAdSetRow, toAdRow } from './entityGraphEngine.js';

// entityId columns are @db.Uuid — a non-UUID string makes Prisma throw on the
// cast (the 500 the feed route documents). Guard before any id-keyed query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_DAYS = Number(process.env.ENTITY_SNAPSHOT_WINDOW_DAYS || 90);

const METRIC_SELECT = {
  entityId: true, date: true, source: true, spendMinor: true, roas: true, ctr: true, frequency: true, currency: true,
  reach: true, // unique people reached — feeds the fatigue exhaustion readout (null when unreported)
  conversions: true, // needed for the account-level Blended CPA aggregate (Σspend / Σconversions)
  // The verdict engine rolls up raw totals and re-derives roas/ctr itself, so it
  // needs the un-ratio'd inputs the display projection never used: revenue, the
  // ctr numerator/denominator. Surfaced here (they already exist on the row) so
  // the connector→verdict adapter never has to zero-fill a missing field.
  // `source` lets effectiveByEntity overlay actual (GA4/Shopify/MANUAL) revenue
  // onto the platform row.
  revenueMinor: true, impressions: true, clicks: true,
  // The funnel bag — what the verdict engine's funnel rules diagnose over
  // (lpv/atc/checkout rates). null when the channel reported none, in which case
  // the rules decline to fire rather than guessing a stage.
  actionMetrics: true,
  dailyBudgetMinor: true,
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
  return effectiveByEntity(snaps);
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
    // externalId = the platform-native campaign id snapshotSink stamps on every
    // synced entity. Carried so the client can deep-link back to the ad platform;
    // nullable for pre-connector rows, which honestly get no link.
    // platformCreatedTime = when the campaign was created ON THE PLATFORM, which
    // is what days-running (and so the too-early gate) must be measured from.
    // `createdAt` is our own row's write time and would report a months-old
    // campaign as brand new on the first sync.
    select:  { id: true, name: true, channel: true, objective: true, externalId: true, platformCreatedTime: true, _count: { select: { adSets: true } } },
    orderBy: { createdAt: 'desc' },
    take:    200,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId }, '[EntityGraph] campaigns read failed');
    return [];
  });
  if (!campaigns.length) return [];

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.CAMPAIGN, campaigns.map((c) => c.id));
  return campaigns.map((c) =>
    toCampaignRow({
      id: c.id, name: c.name, channel: c.channel, objective: c.objective, externalId: c.externalId,
      platformCreatedTime: c.platformCreatedTime, adSetCount: c._count.adSets,
    }, metrics.get(c.id)),
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
    // _count lives INSIDE the select — Prisma rejects `select` and `include`
    // together. Mirrors how getConnectorCampaigns counts adSets. Without it the
    // client cannot tell a drillable ad-set from a leaf and would render an
    // expand chevron that opens onto nothing.
    select:  { id: true, name: true, channel: true, status: true, _count: { select: { ads: true } } },
    orderBy: { createdAt: 'asc' },
    take:    500,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, campaignEntityId }, '[EntityGraph] adsets read failed');
    return [];
  });
  if (!adSets.length) return [];

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.ADSET, adSets.map((a) => a.id));
  return adSets.map((a) => toAdSetRow({ ...a, adCount: a._count?.ads ?? 0 }, metrics.get(a.id)));
}

// Deliberate cap, not a copy of the ad-set level's 500: ads outnumber ad-sets
// several-fold, but a SINGLE ad-set rarely carries more than 20–30. Named so the
// reasoning survives the next reader who wonders why the two levels differ.
export const MAX_ADS_PER_ADSET = 100;

/**
 * Ads of one ad-set (workspace-scoped) with latest metrics.
 * Same contract as getCampaignAdSets one level down:
 * @returns {Promise<Array|null>} rows[] when the ad-set exists in this workspace
 * ([] when it has no ads), or null when it isn't found (→ honest 404, never a
 * fabricated empty drill-down).
 */
export async function getAdSetAds(workspaceId, adSetEntityId) {
  if (!workspaceId || !UUID_RE.test(String(adSetEntityId || ''))) return null;

  const adSet = await prisma.adSet.findFirst({
    where:  { id: adSetEntityId, workspaceId },
    select: { id: true },
  }).catch(() => null);
  if (!adSet) return null;

  const ads = await prisma.ad.findMany({
    where:  { adSetId: adSetEntityId, workspaceId },
    select: { id: true, name: true, channel: true, status: true, platformCreatedTime: true },
    // Ordered by CREATIVE AGE (platform creation), oldest first — the order the
    // fatigue question is asked in. `createdAt` is our own write time and would
    // order by when we happened to sync, so it serves only as a stable tie-break.
    // Nulls last: a roster-only ad whose creation time Meta never reported must
    // not sort ahead of ads with a real, known age.
    orderBy: [
      { platformCreatedTime: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
    take: MAX_ADS_PER_ADSET,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, adSetEntityId }, '[EntityGraph] ads read failed');
    return [];
  });
  if (!ads.length) return [];

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.AD, ads.map((a) => a.id));
  return ads.map((a) => toAdRow(a, metrics.get(a.id)));
}
