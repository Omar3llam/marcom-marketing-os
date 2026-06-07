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

export const PLATFORM_SOURCES = Object.freeze(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
export const ACTUAL_SOURCES   = Object.freeze(['GA4', 'SHOPIFY']);

const LOOKBACK_DAYS = Number(process.env.BLENDED_TRUTH_LOOKBACK_DAYS || 30);

/**
 * Pure: fold raw MetricSnapshot rows into per-channel engine inputs.
 * Exported for unit testing without a DB.
 *
 * @param {Array<object>} snapshots — MetricSnapshot rows
 * @param {Map<string,{name,channel,currency}>} [labelsById] — entity metadata
 * @returns {Array<{channelId, channel, platformRevenueMinor, actualRevenueMinor, spendMinor, currency}>}
 */
export function buildChannelInputs(snapshots, labelsById = new Map()) {
  const byChannel = new Map();
  for (const s of snapshots) {
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
export async function getBlendedTruth(workspaceId, { lookbackDays = LOOKBACK_DAYS } = {}) {
  if (!workspaceId) throw new Error('getBlendedTruth: workspaceId required');

  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const [snapshots, accounts] = await Promise.all([
    prisma.metricSnapshot.findMany({ where: { workspaceId, date: { gte: since } } }),
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true, channel: true } }),
  ]);

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
  const labelsById = new Map(accounts.map((a) => [a.id, { name: a.name, channel: a.channel, currency: ws?.currency }]));

  const channels = buildChannelInputs(snapshots, labelsById);
  if (channels.length === 0) {
    return { channels: [], portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 0, platformRoas: 0, blendedRoas: 0, reconciledCount: 0, unverifiedCount: 0 } };
  }

  const result = reconcile({ channels });
  logger.info({ workspaceId, channels: result.channels.length, gapPct: result.portfolio.gapPct }, '[BlendedTruthService] reconciled');
  return result;
}
