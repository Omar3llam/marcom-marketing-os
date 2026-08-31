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
import { selectOperationalSnapshots } from '../evidence/index.js';
import { attributeCredit } from './attributionEngine.js';
import { ATTRIBUTION_MODEL, ATTRIBUTION_STATUS, EVIDENCE_STATUS } from './attributionTypes.js';
import { getBlendedTruth, latestPerStream } from '../blended-truth/BlendedTruthService.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';

const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);

/**
 * Read that keeps failure and emptiness apart (B5-01T′ · I1).
 *
 *   []    the query ran and this account has nothing — a fact about THEM
 *   null  the query did not run — a fact about US
 *
 * `null`-means-failed is the repository's existing convention for exactly this
 * distinction; see decisionLearning.js (`if (rows === null) → UNAVAILABLE`) and
 * institutionalMemory.js. The catch is NOT removed — swallowing is still the
 * right behaviour here, because one dead read must not blank a report that has
 * real revenue in it. What changes is that the swallow now REMEMBERS.
 */
function readOrNull(promise, { workspaceId, read }) {
  return promise.catch((err) => {
    logger.warn({ err: err.message, workspaceId, read }, '[AttributionService] evidence read failed');
    return null;
  });
}

/**
 * Pure: fold blended-truth channels + conversions + concluded holdouts into
 * the attribution engine's per-channel inputs + the incrementality map.
 * Exported for unit testing without a DB.
 */
export function buildAttributionInputs(channels, conversionsByChannel = new Map(), concludedTests = [], { conversionsAvailable = true } = {}) {
  const engineChannels = channels.map((c) => ({
    channelId:            c.channelId,
    channel:              c.channel,
    // `null`, not 0, when the conversion read failed. The engine is told
    // separately (via `evidence`) and will not read this field — but a defence
    // that relies on the reader behaving is not a defence. A fabricated zero
    // must not exist in the object at all (B5-01T′ · I2).
    conversions:          conversionsAvailable ? (conversionsByChannel.get(c.channelId) ?? 0) : null,
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
  if (channels.length === 0) return { model, status: ATTRIBUTION_STATUS.INSUFFICIENT_DATA, reason: 'no channel data yet' };

  // Per-channel platform-reported conversions (last-click) from MetricSnapshot.
  // Each row is a trailing-window aggregate, so the newest row per stream IS the
  // channel's conversion count — adding the older rows re-counts the same
  // conversions once per sync. `date` is selected only to identify that row.
  //
  // R3: this service no longer states where its evidence lives. The operational
  // population — workspace scope and the window allow-list Phase G introduced —
  // is declared once, in the Evidence layer, and asked for here.
  //
  // THE SAME READ AS ECONOMICS, DELIBERATELY. Both services derive per-channel
  // conversions from the same rows, and the two numbers must never disagree:
  // Attribution divides revenue by them, Economics divides spend by them, so a
  // divergence would make per-conversion value and CAC tell two different
  // stories about one account. Sharing `latestPerStream` kept the REDUCTION in
  // step; asking the same Evidence selector with the same arguments now keeps
  // the POPULATION in step too, which is the half that was still a convention.
  //
  // Preserved exactly, all three for the same reasons Economics states at
  // length: NO temporal bound (a `since` would drop channels whose last sync
  // predates it), NO source filter in the query (PLATFORM_SOURCES is applied
  // below, after the reduction, so a MANUAL row still occupies its own stream),
  // and THE CATCH, which stays here rather than moving into the seam — every
  // other consumer relies on the Evidence layer propagating a read failure.
  //
  // No orderBy: this query never had one, and latestPerStream is documented
  // order-independent precisely so it does not need one.
  const snaps = await readOrNull(selectOperationalSnapshots(workspaceId, {
    entityIds: channels.map((c) => c.channelId),
    select:    { entityId: true, date: true, conversions: true, source: true },
    orderBy:   null,
  }), { workspaceId, read: 'MetricSnapshot' });

  const conversionsByChannel = new Map();
  for (const s of latestPerStream(snaps ?? [])) {
    if (!PLATFORM_SOURCES.has(s.source)) continue;
    conversionsByChannel.set(s.entityId, (conversionsByChannel.get(s.entityId) ?? 0) + (s.conversions ?? 0));
  }

  // Concluded holdouts → incremental conversions (from stored lift × exposed,
  // recomputed as incrementalRevenueMinor / AOV for the engine).
  const tests = await readOrNull(prisma.incrementalityTest.findMany({
    where: { workspaceId, status: 'CONCLUDED' },
  }), { workspaceId, read: 'IncrementalityTest' });

  const aov = economics.aovMinor || 1;
  const enriched = (tests ?? []).map((t) => ({
    ...t,
    _incrementalConversions: t.incrementalRevenueMinor != null ? Math.round(t.incrementalRevenueMinor / aov) : null,
  }));

  // PathTouch — usually empty; when present, path models compute for real.
  const paths = await readOrNull(prisma.pathTouch.findMany({
    where:  { workspaceId },
    select: { conversionId: true, channel: true, touchPosition: true },
    take:   5000,
  }), { workspaceId, read: 'PathTouch' });

  // The three reads' health, carried to the engine so an empty array and a dead
  // query stop arriving as the same fact (B5-01T′ · I1).
  const evidence = {
    conversions:    snaps === null ? EVIDENCE_STATUS.UNAVAILABLE : EVIDENCE_STATUS.OK,
    incrementality: tests === null ? EVIDENCE_STATUS.UNAVAILABLE : EVIDENCE_STATUS.OK,
    paths:          paths === null ? EVIDENCE_STATUS.UNAVAILABLE : EVIDENCE_STATUS.OK,
  };

  const { engineChannels, incrementality } = buildAttributionInputs(
    channels, conversionsByChannel, enriched, { conversionsAvailable: snaps !== null },
  );
  const result = attributeCredit({
    channels: engineChannels, model, paths: paths ?? [],
    incrementality, economics: { aovMinor: economics.aovMinor }, evidence,
  });

  if (result.status === ATTRIBUTION_STATUS.EVIDENCE_UNAVAILABLE) {
    logger.warn({ workspaceId, model, evidence }, '[AttributionService] attributed on incomplete evidence');
  } else {
    logger.info({ workspaceId, model, status: result.status }, '[AttributionService] attributed');
  }
  return result;
}
