// ============================================================
// AttributionService — persistence wrapper for the attribution engine
// ============================================================
// Owns DB I/O (the deterministic attributionEngine never touches it).
//   getAttribution(): blended truth + per-channel conversions + concluded
//                     IncrementalityTests + P6 economics + PathTouch rows
//                     (usually empty) → attributeCredit → Attributed outputs.
//                     Ephemeral; NO writes (mirrors previewAllocation).
//
// Honest by construction: path models go dark (INSUFFICIENT_DATA) until a
// path source populates PathTouch; INCREMENTALITY_WEIGHTED uses measured
// holdout lift, never invented journey credit.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { attributeCredit } from './attributionEngine.js';
import { ATTRIBUTION_MODEL } from './attributionTypes.js';
import { getBlendedTruth, latestPerStream } from '../blended-truth/BlendedTruthService.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';

const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);

/**
 * Pure: fold blended-truth channels + conversions + concluded holdouts into
 * the attribution engine's per-channel inputs + the incrementality map.
 * Exported for unit testing without a DB.
 */
export function buildAttributionInputs(channels, conversionsByChannel = new Map(), concludedTests = []) {
  const engineChannels = channels.map((c) => ({
    channelId:            c.channelId,
    channel:              c.channel,
    conversions:          conversionsByChannel.get(c.channelId) ?? 0,
    platformRevenueMinor: c.platformRevenueMinor,
    blendedRevenueMinor:  c.blendedRevenueMinor,
    spendMinor:           c.spendMinor,
    currency:             c.currency,
  }));

  // Map a concluded holdout to a channelId via entityId, else channel name.
  const incrementality = {};
  for (const t of concludedTests) {
    const match = channels.find((c) => (t.entityId && c.channelId === t.entityId) || c.channel === t.channel);
    if (!match) continue;
    // incrementalConversions is derived from the stored revenue / AOV (the
    // service enriches each test with `_incrementalConversions` before this).
    incrementality[match.channelId] = {
      incrementalConversions: t._incrementalConversions ?? null,
      confidenceLabel:        t.confidenceLabel,
      ciLow:                  t.ciLow,
      ciHigh:                 t.ciHigh,
    };
  }
  return { engineChannels, incrementality };
}

/**
 * Compute attribution for a workspace under a model.
 * @returns {Promise<object>} attributeCredit() output (Attributed wrappers)
 */
export async function getAttribution(workspaceId, { model = ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED } = {}) {
  if (!workspaceId) throw new Error('getAttribution: workspaceId required');

  const [{ channels }, { economics }] = await Promise.all([
    getBlendedTruth(workspaceId),
    getEconomics(workspaceId),
  ]);
  if (channels.length === 0) return { model, status: 'INSUFFICIENT_DATA', reason: 'no channel data yet' };

  // Per-channel platform-reported conversions (last-click) from MetricSnapshot.
  // Each row is a trailing-window aggregate, so the newest row per stream IS the
  // channel's conversion count — adding the older rows re-counts the same
  // conversions once per sync. `date` is selected only to identify that row.
  const snaps = await prisma.metricSnapshot.findMany({
    where:  { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    select: { entityId: true, date: true, conversions: true, source: true },
  }).catch(() => []);
  const conversionsByChannel = new Map();
  for (const s of latestPerStream(snaps)) {
    if (!PLATFORM_SOURCES.has(s.source)) continue;
    conversionsByChannel.set(s.entityId, (conversionsByChannel.get(s.entityId) ?? 0) + (s.conversions ?? 0));
  }

  // Concluded holdouts → incremental conversions (from stored lift × exposed,
  // recomputed as incrementalRevenueMinor / AOV for the engine).
  const tests = await prisma.incrementalityTest.findMany({
    where: { workspaceId, status: 'CONCLUDED' },
  }).catch(() => []);
  const aov = economics.aovMinor || 1;
  const enriched = tests.map((t) => ({
    ...t,
    _incrementalConversions: t.incrementalRevenueMinor != null ? Math.round(t.incrementalRevenueMinor / aov) : null,
  }));

  // PathTouch — usually empty; when present, path models compute for real.
  const paths = await prisma.pathTouch.findMany({
    where:  { workspaceId },
    select: { conversionId: true, channel: true, touchPosition: true },
    take:   5000,
  }).catch(() => []);

  const { engineChannels, incrementality } = buildAttributionInputs(channels, conversionsByChannel, enriched);
  const result = attributeCredit({
    channels: engineChannels, model, paths,
    incrementality, economics: { aovMinor: economics.aovMinor },
  });

  logger.info({ workspaceId, model, status: result.status }, '[AttributionService] attributed');
  return result;
}
