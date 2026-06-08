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
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';

const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);

/**
 * Build the attribution engine's per-channel inputs and an incrementality lookup from blended-truth channels, platform conversions, and concluded holdout tests.
 *
 * @param {Array<Object>} channels - Blended-truth channel records each containing at least `channelId`, `channel`, `platformRevenueMinor`, `blendedRevenueMinor`, `spendMinor`, and `currency`.
 * @param {Map<string, number>} [conversionsByChannel=new Map()] - Map from `channelId` to platform-reported conversion count; missing keys are treated as `0`.
 * @param {Array<Object>} [concludedTests=[]] - Concluded holdout test records; tests may include `entityId`, `channel`, `confidenceLabel`, `ciLow`, `ciHigh`, and an enriched `_incrementalConversions` numeric value or `null`.
 * @returns {Object} An object with:
 *   - `engineChannels` — array of engine channel objects ({ channelId, channel, conversions, platformRevenueMinor, blendedRevenueMinor, spendMinor, currency }),
 *   - `incrementality` — lookup keyed by `channelId` with values ({ incrementalConversions: number|null, confidenceLabel, ciLow, ciHigh }) for channels matched to concluded tests.
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
 * Compute attribution for a workspace using the specified attribution model.
 *
 * Builds engine inputs from blended-truth channels, platform-reported conversions, concluded holdout tests, and optional path touches, then runs the deterministic attribution engine.
 * @param {string} workspaceId - Workspace identifier.
 * @param {Object} [options] - Optional settings.
 * @param {string} [options.model] - Attribution model to use (defaults to INCREMENTALITY_WEIGHTED).
 * @throws {Error} If `workspaceId` is falsy.
 * @returns {Promise<object>} Attribution engine result object containing status and attribution details.
export async function getAttribution(workspaceId, { model = ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED } = {}) {
  if (!workspaceId) throw new Error('getAttribution: workspaceId required');

  const [{ channels }, { economics }] = await Promise.all([
    getBlendedTruth(workspaceId),
    getEconomics(workspaceId),
  ]);
  if (channels.length === 0) return { model, status: 'INSUFFICIENT_DATA', reason: 'no channel data yet' };

  // Per-channel platform-reported conversions (last-click) from MetricSnapshot.
  const snaps = await prisma.metricSnapshot.findMany({
    where:  { workspaceId, entityId: { in: channels.map((c) => c.channelId) } },
    select: { entityId: true, conversions: true, source: true },
  }).catch(() => []);
  const conversionsByChannel = new Map();
  for (const s of snaps) {
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
