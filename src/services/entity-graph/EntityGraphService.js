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
import { selectOperationalSnapshots } from '../evidence/index.js';
import {
  selectCanonicalVerdictSnapshots, latestCanonicalByEntity, partitionByCanonicalEvidence,
} from '../verdict-engine/canonicalVerdictEvidence.js';
import { TEMPORAL } from '../../config/temporal.js';

// entityId columns are @db.Uuid — a non-UUID string makes Prisma throw on the
// cast (the 500 the feed route documents). Guard before any id-keyed query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bounds MetricSnapshot.date — the SYNC timestamp. Not how much delivery the
// rows describe: each is a ROLLING_WINDOW aggregate of whatever period its sync
// requested. Value unchanged (90); see config/temporal.js.
const SYNC_RECENCY_DAYS = TEMPORAL.entitySnapshotSyncRecencyDays;

// Exported for the Phase-C provenance test, which asserts that this reader does
// NOT yet select `measurementWindow` — resolution by window is Phase D, and the
// test is what makes the boundary between the two phases visible rather than
// implied. Export only; the object and its use are unchanged.
export const METRIC_SELECT = {
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
  const since = new Date(Date.now() - SYNC_RECENCY_DAYS * 24 * 60 * 60 * 1000);
  const snaps = await selectOperationalSnapshots(workspaceId, {
    // R3.9. This file no longer states WHERE its operational evidence lives; the
    // population is declared once, in the Evidence layer, and asked for here.
    // The reason it must be OPERATIONAL ONLY has not changed one bit:
    // effectiveByEntity picks the latest row per entity on `date`, and Phase F
    // lands a canonical row at the SAME `date` as the operational one — so
    // without that filter the spend, ROAS and frequency this surface shows (and
    // every verdict derived from it) would be decided by Postgres row order.
    // Phase D is what teaches this reader to consume canonical rows; until then
    // they are not its population.
    //
    // This service is the one consumer that reads BOTH populations, and they stay
    // apart on purpose: getCanonicalVerdictCampaigns below asks a different
    // selector, over a different measurement. Two seams, never one with a mode
    // flag. (No selector is NAMED in this function on purpose — two guards read
    // this body as text and assert it calls nothing canonical.)
    //
    // `since` is a SYNC-RECENCY bound on `date` (R2's distinction): 90 days of
    // "when we last pulled this row", never 90 days of delivery. The rows are
    // rolling aggregates covering whatever period their sync requested.
    //
    // `orderBy: null` reproduces the absent ORDER BY this query has always run
    // without. effectiveByEntity compares dates itself and is order-independent,
    // so asking the database to sort would add a plan change and buy nothing.
    entityLevel,
    entityIds,
    since,
    select:  METRIC_SELECT,
    orderBy: null,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId, entityLevel }, '[EntityGraph] snapshot read failed');
    return [];
  });
  return effectiveByEntity(snaps);
}

/**
 * The CAMPAIGN identities a verdict could be about — names, channels and the
 * platform facts the engine needs, with NO metrics attached.
 *
 * Deliberately separate from getConnectorCampaigns: that one joins OPERATIONAL
 * metrics for the Campaigns surface and must go on doing exactly that. This one
 * exists so the verdict path can take identity from the entity graph and
 * evidence from somewhere else entirely.
 */
async function verdictCampaignIdentities(workspaceId) {
  return prisma.campaign.findMany({
    where:   { workspaceId },
    select:  { id: true, name: true, channel: true, objective: true, externalId: true, platformCreatedTime: true, _count: { select: { adSets: true } } },
    orderBy: { createdAt: 'desc' },
    take:    200,
  }).catch((err) => {
    logger.debug({ err: err.message, workspaceId }, '[EntityGraph] verdict identities read failed');
    return [];
  });
}

/**
 * Campaign rows for the VERDICT path, built from canonical CUMULATIVE_30D
 * evidence (Phase D.4).
 *
 * Two things make this different from getConnectorCampaigns, and both are the
 * point of the phase:
 *
 *   1. The metrics come from the canonical selector, not latestSnapshots. That
 *      reader stays exactly as it was — it feeds ROAS, CTR, spend and revenue to
 *      the Campaigns surface, and converting it would have moved four unrelated
 *      metrics to a different measurement period as a side effect.
 *
 *   2. effectiveByEntity is NOT applied. That is what overlays GA4 / Shopify /
 *      MANUAL revenue onto a platform row and re-derives ROAS from it — actual
 *      revenue of unknown period over canonical spend. Bypassed here only; the
 *      overlay still runs for every other consumer.
 *
 * A campaign with no canonical row is returned in `noCanonicalWindow` rather
 * than as a row with null metrics — the caller must be able to tell "not
 * measured over this window" from "measured, and it was zero".
 *
 * @returns {Promise<{campaigns: Array, noCanonicalWindow: Array}>}
 */
export async function getCanonicalVerdictCampaigns(workspaceId) {
  if (!workspaceId) return { campaigns: [], noCanonicalWindow: [] };

  const identities = await verdictCampaignIdentities(workspaceId);
  if (!identities.length) return { campaigns: [], noCanonicalWindow: [] };

  // Filter BEFORE latest: the query narrows to canonical/platform/campaign, and
  // only then is the newest of those chosen.
  const rows = await selectCanonicalVerdictSnapshots(workspaceId, identities.map((c) => c.id));
  const { withEvidence, absent } = partitionByCanonicalEvidence(identities, latestCanonicalByEntity(rows));

  return {
    campaigns: withEvidence.map(({ identity, snapshot }) =>
      toCampaignRow({
        id: identity.id, name: identity.name, channel: identity.channel, objective: identity.objective,
        externalId: identity.externalId, platformCreatedTime: identity.platformCreatedTime,
        adSetCount: identity._count.adSets,
      }, snapshot),
    ),
    noCanonicalWindow: absent,
  };
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
 * Ad-sets of one campaign (workspace-scoped) with latest metrics, plus the
 * campaign row they hang off. Mirrors getAdSetAds one level up, for the same
 * reason: ranking children needs the PARENT's own measured row as a baseline,
 * and the objective that selects the bar. Unlike at ad-set level, `objective` is
 * a real Campaign column — no relation select needed.
 *
 * @returns {Promise<{entity, objective, adSets}|null>} the envelope when the
 * campaign exists in this workspace (`adSets: []` when it has none), or null
 * when it isn't found (→ honest 404, never a fabricated empty drill-down).
 */
export async function getCampaignAdSets(workspaceId, campaignEntityId) {
  if (!workspaceId || !UUID_RE.test(String(campaignEntityId || ''))) return null;

  const campaign = await prisma.campaign.findFirst({
    where:  { id: campaignEntityId, workspaceId },
    // The same field set getConnectorCampaigns selects, so one campaign has ONE
    // row shape wherever it is read from. externalId and platformCreatedTime are
    // not optional decoration: dropping them here would make the same campaign
    // lose its platform deep-link and its age depending on which route fetched it.
    select: {
      id: true, name: true, channel: true, objective: true,
      externalId: true, platformCreatedTime: true,
      _count: { select: { adSets: true } },
    },
  }).catch(() => null);
  if (!campaign) return null;

  // Independent reads — the campaign's own snapshot does not depend on the
  // ad-set list, so it does not wait behind it.
  const [campaignSnaps, adSets] = await Promise.all([
    latestSnapshots(workspaceId, ENTITY_LEVEL.CAMPAIGN, [campaignEntityId]),
    prisma.adSet.findMany({
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
    }),
  ]);

  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.ADSET, adSets.map((a) => a.id));

  return {
    // adSetCount rides ON the entity object — toCampaignRow takes (campaign, snap).
    entity: toCampaignRow({ ...campaign, adSetCount: campaign._count?.adSets ?? 0 }, campaignSnaps.get(campaignEntityId)),
    objective: campaign.objective ?? null,
    adSets: adSets.map((a) => toAdSetRow({ ...a, adCount: a._count?.ads ?? 0 }, metrics.get(a.id))),
  };
}

// Deliberate cap, not a copy of the ad-set level's 500: ads outnumber ad-sets
// several-fold, but a SINGLE ad-set rarely carries more than 20–30. Named so the
// reasoning survives the next reader who wonders why the two levels differ.
export const MAX_ADS_PER_ADSET = 100;

/**
 * Ads of one ad-set (workspace-scoped) with latest metrics, PLUS the two things
 * a ranking of those ads cannot be honest without:
 *
 *   entity    — the ad-set's OWN measured row. This is the BASELINE children are
 *               ranked against. Deliberately not a mean of the children: an
 *               unweighted average of ratios is a number no snapshot contains,
 *               and it weighs a 100-impression ad equally with a 100,000 one.
 *   objective — the campaign's objective, which selects the CTR bar. Read off the
 *               `campaign` RELATION, not a column: AdSet carries campaignId but
 *               no objective of its own, so this is a nested select on the
 *               ownership query rather than a second round-trip.
 *
 * Same null-vs-empty contract as getCampaignAdSets one level down:
 * @returns {Promise<{entity, objective, children}|null>} the envelope when the
 * ad-set exists in this workspace (`children: []` when it has no ads), or null
 * when it isn't found (→ honest 404, never a fabricated empty drill-down).
 */
export async function getAdSetAds(workspaceId, adSetEntityId) {
  if (!workspaceId || !UUID_RE.test(String(adSetEntityId || ''))) return null;

  const adSet = await prisma.adSet.findFirst({
    where:  { id: adSetEntityId, workspaceId },
    // _count lives INSIDE the select — Prisma rejects `select` and `include`
    // together. Same shape as the ad-set level above.
    select: {
      id: true, name: true, channel: true, status: true,
      _count:   { select: { ads: true } },
      campaign: { select: { objective: true } },
    },
  }).catch(() => null);
  if (!adSet) return null;

  // Independent reads — the ad-set's own snapshot does not depend on the child
  // list, so it does not wait behind it.
  const [adSetSnaps, ads] = await Promise.all([
    latestSnapshots(workspaceId, ENTITY_LEVEL.ADSET, [adSetEntityId]),
    prisma.ad.findMany({
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
    }),
  ]);

  // latestSnapshots short-circuits on an empty id list, so a childless ad-set
  // still costs no query here — and still returns a real `entity`.
  const metrics = await latestSnapshots(workspaceId, ENTITY_LEVEL.AD, ads.map((a) => a.id));

  return {
    // adCount rides ON the entity object — toAdSetRow takes (adSet, snap) and
    // would silently report 0 for a third positional argument. It comes from
    // _count, the TRUE total: counting the returned array instead would tell a
    // 140-ad ad-set it has MAX_ADS_PER_ADSET.
    entity:    toAdSetRow({ ...adSet, adCount: adSet._count?.ads ?? 0 }, adSetSnaps.get(adSetEntityId)),
    objective: adSet.campaign?.objective ?? null,
    children:  ads.map((a) => toAdRow(a, metrics.get(a.id))),
  };
}
