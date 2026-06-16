// ============================================================
// FatigueSweepService — persistence wrapper for the forecaster
// ============================================================
// The WRITE organ the forecaster was missing. Mirrors GuardrailSweepService:
// load recent MetricSnapshots → build a per-entity frequency series → run the
// deterministic forecaster → persist a FatiguePrediction for each projected
// breach. A forecast NEVER auto-executes: a FatiguePrediction is a read-side
// radar artifact the feed / Growth board / agentic planner consume.
//
// CORRECTNESS — the substrate seam (the bug class this codebase has hit before):
//   entityId is taken STRAIGHT from MetricSnapshot.entityId — the same
//   entity-graph UUID that Campaign.id / AdSet.id use and that getConnectorCampaigns,
//   the feed passthrough, and the planner all key on. Building the series and
//   writing the prediction from the same row makes the join sound by construction
//   (no name↔UUID guess — that's exactly why the CSV feed table can't carry this).
//
// IDEMPOTENCY: each sweep replaces the workspace's UNRESOLVED predictions in one
// transaction (delete-then-createMany). One current projection per breaching
// entity — readers never see duplicate or stale breaches. RESOLVED predictions
// (the accuracy/memory record) are never touched.
// ============================================================
import { prisma }           from '../../lib/prisma.js';
import { logger }           from '../../utils/logger.js';
import { forecastFatigue }  from './fatigueForecaster.js';

const LOOKBACK_DAYS = Number(process.env.FATIGUE_LOOKBACK_DAYS || 30);
const CEILING       = Number(process.env.FATIGUE_CEILING || 3.5);
const MIN_POINTS    = 2; // the forecaster needs ≥2 to fit a trend

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Build a clean per-entity frequency series from raw snapshots:
 *  - keep only finite, non-negative frequency points
 *  - one point per calendar day (last write of the day wins — deterministic,
 *    so two sources writing the same entity+day don't distort the day-index fit)
 *  - ≥2 distinct days, else the entity can't be forecast
 *
 * @returns {Array<{entityId, entityLevel, series:[{date,frequency,ctr?}]}>}
 */
export function buildEntitySeries(snapshots = []) {
  const byEntity = new Map();
  for (const s of snapshots) {
    if (!s || !s.entityId) continue;
    if (!isFiniteNum(s.frequency) || s.frequency < 0) continue;
    const key = `${s.entityId}:${s.entityLevel}`;
    if (!byEntity.has(key)) {
      byEntity.set(key, { entityId: s.entityId, entityLevel: s.entityLevel, byDay: new Map() });
    }
    const point = { date: s.date, frequency: s.frequency };
    if (isFiniteNum(s.ctr)) point.ctr = s.ctr;
    byEntity.get(key).byDay.set(dayKey(s.date), point); // last-of-day wins
  }

  const out = [];
  for (const { entityId, entityLevel, byDay } of byEntity.values()) {
    if (byDay.size < MIN_POINTS) continue;
    const series = [...byDay.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    out.push({ entityId, entityLevel, series });
  }
  return out;
}

/**
 * Run the fatigue forecast sweep for one workspace.
 * @returns {Promise<{ scanned:number, forecastable:number, breaching:number, written:number }>}
 */
export async function sweepFatigue(workspaceId, { now = new Date() } = {}) {
  if (!workspaceId) throw new Error('sweepFatigue: workspaceId required');

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const snapshots = await prisma.metricSnapshot.findMany({
    where:  { workspaceId, granularity: 'DAILY', date: { gte: since } },
    select: { entityId: true, entityLevel: true, date: true, frequency: true, ctr: true },
    orderBy: { date: 'asc' },
  });

  // Cold read (no data at all): leave existing predictions untouched rather than
  // wipe them on a possibly-transient empty window.
  if (snapshots.length === 0) {
    logger.debug({ workspaceId }, '[FatigueSweep] no snapshots in window — skipped');
    return { scanned: 0, forecastable: 0, breaching: 0, written: 0 };
  }

  const entities = buildEntitySeries(snapshots);

  // Forecast each entity (pure, no DB). Collect only projected breaches; a flat /
  // declining entity yields willBreach:false → no row (never a fabricated breach).
  const rows = [];
  for (const e of entities) {
    let forecast;
    try {
      forecast = forecastFatigue({ series: e.series, ceiling: CEILING });
    } catch (err) {
      logger.warn({ workspaceId, entityId: e.entityId, err: err.message }, '[FatigueSweep] forecast skipped');
      continue;
    }
    if (!forecast.willBreach || !forecast.projectedBreachDate) continue;
    rows.push({
      workspaceId,
      entityId:            e.entityId,
      entityLevel:         e.entityLevel,
      metric:              forecast.metric,
      ceiling:             forecast.ceiling,
      projectedBreachDate: new Date(forecast.projectedBreachDate),
      confidence:          forecast.confidence,
      basis:               forecast.basis,
    });
  }

  // Idempotent reconcile: replace this workspace's UNRESOLVED predictions in one
  // transaction so readers never see duplicates or a projection the latest data
  // no longer supports. Resolved rows (accuracy/memory record) are preserved.
  await prisma.$transaction([
    prisma.fatiguePrediction.deleteMany({ where: { workspaceId, resolvedAt: null } }),
    ...(rows.length > 0 ? [prisma.fatiguePrediction.createMany({ data: rows })] : []),
  ]);

  logger.info(
    { workspaceId, scanned: snapshots.length, forecastable: entities.length, breaching: rows.length },
    '[FatigueSweep] complete',
  );
  return { scanned: snapshots.length, forecastable: entities.length, breaching: rows.length, written: rows.length };
}
