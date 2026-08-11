// ============================================================
// actualsSink — land ACTUAL revenue onto EXISTING entities (never mint)
// ============================================================
// The dedicated landing path for cross-channel actuals (GA4 today). It is
// deliberately NOT snapshotSink.landSnapshots: that path derives entityId from
// a connector-level channel and MINTS a channel-namespaced entity. An actual
// must instead DECORATE an entity another connector already created, sharing its
// exact entityId so BlendedTruth reconciles platform-claimed vs actual by source.
// (snapshotSink stays untouched — zero regression risk for Meta/Google/CSV.)
//
// Resolution is honest by construction: a GA4 actual attaches to a matching
// CAMPAIGN entity (by channel + name), else falls back to that channel's ACCOUNT
// entity, else is DROPPED — we never fabricate an entity to hang revenue on.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { CHANNEL, DATA_SOURCE, ENTITY_LEVEL, MEASUREMENT_WINDOW } from './connectorTypes.js';

const round = (n) => Math.round(n);
const lc = (v) => String(v ?? '').toLowerCase().trim();

/**
 * Structural guard for actual descriptors at the boundary (mirrors
 * assertNormalized's spirit): a real ad CHANNEL, source ACTUAL, integer revenue.
 * Throws on the first malformed row.
 */
export function assertActuals(descriptors) {
  if (!Array.isArray(descriptors)) throw new Error('actuals must be an array');
  for (const r of descriptors) {
    if (!r || typeof r !== 'object') throw new Error('actual descriptor must be an object');
    if (!Object.values(CHANNEL).includes(r.channel)) throw new Error(`actual: bad channel tag: ${r.channel}`);
    if (r.source !== DATA_SOURCE.GA4 && r.source !== DATA_SOURCE.SHOPIFY) {
      throw new Error(`actual: source must be an ACTUAL source (GA4/SHOPIFY): ${r.source}`);
    }
    if (!Number.isInteger(r.revenueMinor) || r.revenueMinor < 0) {
      throw new Error(`actual: revenueMinor must be a non-negative integer (minor units): ${r.revenueMinor}`);
    }
  }
  return descriptors;
}

/**
 * PURE: resolve one descriptor to the EXISTING entity it decorates, or null.
 * @param {object} descriptor — { channel, campaignName }
 * @param {{ campaignByKey: Map<string,string>, accountByChannel: Map<string,string> }} graph
 *   campaignByKey keyed `${channel}|${lower(name)}` → entityId; accountByChannel
 *   keyed channel → entityId. Both built from entities that REALLY exist.
 * @returns {{ entityId, entityLevel } | null} null ⇒ drop (no fabricated entity)
 */
export function resolveAttachment(descriptor, { campaignByKey, accountByChannel }) {
  const { channel, campaignName } = descriptor;
  if (campaignName) {
    const hit = campaignByKey.get(`${channel}|${lc(campaignName)}`);
    if (hit) return { entityId: hit, entityLevel: ENTITY_LEVEL.CAMPAIGN };
  }
  const acct = accountByChannel.get(channel);
  if (acct) return { entityId: acct, entityLevel: ENTITY_LEVEL.ACCOUNT };
  return null;
}

/**
 * PURE: an actual descriptor + its resolved attachment → a MetricSnapshot row.
 * An actuals row carries NO spend, so the spend-derived ratios (roas/cpa/ctr)
 * are null — never a misleading 0 computed from a zero-spend row. BlendedTruth
 * reads revenueMinor by source; those ratios are not its inputs.
 */
export function toActualSnapshotRow(workspaceId, attachment, descriptor) {
  return {
    workspaceId,
    entityId: attachment.entityId,
    entityLevel: attachment.entityLevel,
    date: descriptor.date instanceof Date ? descriptor.date : new Date(descriptor.date),
    source: descriptor.source,
    granularity: 'DAILY',
    // LEGACY_UNKNOWN, and not because this row is old — because an actual has no
    // measurement period we can establish. A GA4 pull is bounded by the request
    // range the connector chose, and that range is not carried on the descriptor
    // and is not persisted anywhere. Claiming ROLLING_WINDOW would assert a
    // period; claiming CUMULATIVE_30D would assert the canonical one. Both would
    // be inventions, and this row is the numerator of a ROAS — the number
    // metricWindow.sameWindow() exists to stop being divided by a mismatched
    // denominator. Phase F is where an actual gains a real window.
    measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
    windowStart: null,
    windowEnd: null,
    spendMinor: 0,
    revenueMinor: round(descriptor.revenueMinor || 0),
    cpaMinor: null,
    impressions: 0,
    clicks: 0,
    conversions: round(descriptor.conversions || 0),
    ctr: null,
    roas: null,
    frequency: null,
    currency: descriptor.currency || 'USD',
  };
}

/**
 * Land actual descriptors for a workspace: resolve each to an existing entity,
 * upsert its MetricSnapshot by the same natural key the connector sink uses.
 * Idempotent. Descriptors with no matching entity are DROPPED (counted, logged),
 * never landed on a fabricated entity.
 * @returns {Promise<{ snapshots, attached, dropped }>}
 */
export async function landActuals(workspaceId, descriptors = []) {
  if (!workspaceId) throw new Error('landActuals: workspaceId required');
  if (!descriptors.length) return { snapshots: 0, attached: 0, dropped: 0 };

  const [campaigns, accounts] = await Promise.all([
    prisma.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true, channel: true } }),
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, channel: true } }),
  ]);
  const campaignByKey = new Map(campaigns.map((c) => [`${c.channel}|${lc(c.name)}`, c.id]));
  const accountByChannel = new Map(accounts.map((a) => [a.channel, a.id]));

  const built = descriptors.map((d) => {
    const attachment = resolveAttachment(d, { campaignByKey, accountByChannel });
    return attachment ? toActualSnapshotRow(workspaceId, attachment, d) : null;
  });
  const rows = built.filter(Boolean);
  const dropped = built.length - rows.length; // descriptors with no existing entity to decorate

  if (rows.length) {
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
  }

  logger.info({ workspaceId, snapshots: rows.length, attached: rows.length, dropped }, '[actualsSink] landed actuals');
  return { snapshots: rows.length, attached: rows.length, dropped };
}
