// ============================================================
// ScenarioService — persistence wrapper for the scenario engine
// ============================================================
// Owns DB I/O (the deterministic scenarioEngine never touches it).
//   runScenario():          blended truth + economics + memory accuracy →
//                           projectScenario → ranges + assumptions. NO
//                           writes (ephemeral, mirrors previewAllocation).
//   gatherLeadingSignals(): per-entity MetricSnapshot series →
//                           forecastFatigue → the leadingSignals[] the
//                           goal tracker consumes (reuse, no new math).
//
// "Powered by Memory": the memory accuracy band widens the scenario range,
// AND the patterns leaned on are returned as `memoryBasis` for traceability.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { projectScenario } from './scenarioEngine.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';
import { forecastFatigue } from '../fatigue-forecaster/fatigueForecaster.js';

const FATIGUE_LOOKBACK_DAYS = Number(process.env.SCENARIO_FATIGUE_LOOKBACK_DAYS || 30);

/**
 * Pure: fold blended-truth channels + economics + learned patterns into
 * the scenario engine's inputs. Exported for unit testing without a DB.
 *
 * @returns {{ baseline, economics, memory, memoryBasis }}
 */
export function buildScenarioInputs(channels, economics, patterns = []) {
  const baseline = channels.map((c) => ({
    channelId:   c.channelId,
    channel:     c.channel,
    spendMinor:  c.spendMinor,
    blendedRoas: c.blendedRoas,
    currency:    c.currency,
  }));
  const memory = patterns
    .filter((p) => typeof p.accuracy === 'number' && Number.isFinite(p.accuracy))
    .map((p) => ({ cohort: p.cohortTag ?? null, accuracy: p.accuracy }));
  const memoryBasis = patterns
    .filter((p) => typeof p.accuracy === 'number' && Number.isFinite(p.accuracy))
    .map((p) => ({ patternId: p.id, kind: p.kind, statement: p.statement, accuracy: p.accuracy }));
  return {
    baseline,
    economics: { aovMinor: economics.aovMinor, grossMarginPct: economics.grossMarginPct, currency: economics.currency },
    memory,
    memoryBasis,
  };
}

/**
 * Run a what-if scenario for a workspace.
 * @returns {Promise<(object|null)>} the scenario + memoryBasis, or null if no channels
 */
export async function runScenario(workspaceId, { change, now } = {}) {
  if (!workspaceId) throw new Error('runScenario: workspaceId required');

  const [{ channels }, { economics }] = await Promise.all([
    getBlendedTruth(workspaceId),
    getEconomics(workspaceId),
  ]);
  if (channels.length === 0) return null;

  // Memory: established, accurate patterns inform the band width + basis.
  const patterns = await prisma.accountPattern.findMany({
    where:   { workspaceId, status: { in: ['ESTABLISHED', 'EMERGING'] }, accuracy: { not: null } },
    orderBy: { confidence: 'desc' },
    take:    20,
  }).catch(() => []);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { cohortTag: true } });
  const enriched = patterns.map((p) => ({ ...p, cohortTag: p.cohortTag ?? ws?.cohortTag ?? null }));

  const { baseline, economics: econ, memory, memoryBasis } = buildScenarioInputs(channels, economics, enriched);
  const scenario = projectScenario({ baseline, change, economics: econ, memory, now });

  logger.info({ workspaceId, type: change?.type, patterns: memoryBasis.length }, '[ScenarioService] projected');
  return { ...scenario, memoryBasis };
}

/**
 * Build leading fatigue signals for a set of entities (reuse forecastFatigue).
 * @returns {Promise<Array<{signal, entityId, projectedBreachDate, daysToBreach, confidence}>>}
 */
export async function gatherLeadingSignals(workspaceId, { entityIds = [], now } = {}) {
  if (!workspaceId) throw new Error('gatherLeadingSignals: workspaceId required');
  if (entityIds.length === 0) return [];

  const since = new Date((now ? new Date(now).getTime() : Date.now()) - FATIGUE_LOOKBACK_DAYS * 86_400_000);
  const snapshots = await prisma.metricSnapshot.findMany({
    where:   { workspaceId, entityId: { in: entityIds }, date: { gte: since } },
    orderBy: { date: 'asc' },
    select:  { entityId: true, date: true, frequency: true, ctr: true },
  }).catch(() => []);

  // Group into a per-entity series, then forecast.
  const byEntity = new Map();
  for (const s of snapshots) {
    if (s.frequency == null) continue;
    if (!byEntity.has(s.entityId)) byEntity.set(s.entityId, []);
    byEntity.get(s.entityId).push({ date: s.date, frequency: s.frequency, ctr: s.ctr ?? undefined });
  }

  const signals = [];
  for (const [entityId, series] of byEntity) {
    if (series.length < 2) continue;
    try {
      const f = forecastFatigue({ series });
      if (f.willBreach && f.projectedBreachDate) {
        signals.push({
          signal: 'creative_fatigue',
          entityId,
          projectedBreachDate: f.projectedBreachDate,
          daysToBreach: f.daysToBreach,
          confidence: f.confidence,
        });
      }
    } catch (err) {
      logger.debug({ err: err.message, entityId }, '[ScenarioService] fatigue forecast skipped');
    }
  }
  return signals;
}
