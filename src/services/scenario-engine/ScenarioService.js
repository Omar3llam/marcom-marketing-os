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
import { selectCanonicalFatigueSnapshots } from '../fatigue-forecaster/canonicalFatigueEvidence.js';
import { buildEntitySeries } from '../fatigue-forecaster/FatigueSweepService.js';
import { TEMPORAL } from '../../config/temporal.js';

// Bounds MetricSnapshot.date — the SYNC timestamp — on canonical CUMULATIVE_30D
// rows. Deliberately its own setting rather than sharing the fatigue one: a
// scenario projection and a persisted fatigue prediction are different products
// and may want different depths of history. Value unchanged (30).
const FATIGUE_SYNC_RECENCY_DAYS = TEMPORAL.scenarioFatigueSyncRecencyDays;

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

// The projection fields that are DERIVED from unit economics (AOV / gross margin)
// rather than from spend × real blendedRoas. When economics is unconfigured these
// rest on the seeded default AOV, so they must be blanked — never dressed as a
// measurement (mirrors getEconomicsAssessment's NOT_CONFIGURED refusal).
const ECONOMICS_DERIVED_PROJECTIONS = Object.freeze(['volume', 'blendedCacMinor', 'grossProfitMinor']);
const BLANK_RANGE = Object.freeze({ low: null, expected: null, high: null });
const NOT_CONFIGURED_ASSUMPTION =
  'Volume, CAC and Gross Profit require configured Unit Economics. ' +
  'Default AOV was intentionally not used — configure Economics to unlock these projections.';

/**
 * Pure: stamp `economicsStatus` and, when the workspace has NOT asserted its
 * unit economics (`isDefault`), blank the AOV/margin-derived projections to honest
 * null ranges (→ "—") plus an explicit assumption. Spend/ROAS-based projections
 * (revenueMinor, merAfter) are economics-independent and always preserved.
 * Exported for unit testing without a DB.
 *
 * @param {object} scenario — projectScenario() output
 * @param {boolean} isDefault — true when economics is the seeded default (unconfigured)
 * @returns {object} scenario decorated with economicsStatus (+ blanked projections)
 */
export function withEconomicsStatus(scenario, isDefault) {
  if (!isDefault) return { ...scenario, economicsStatus: 'CONFIGURED' };
  const projections = { ...scenario.projections };
  for (const key of ECONOMICS_DERIVED_PROJECTIONS) projections[key] = { ...BLANK_RANGE };
  return {
    ...scenario,
    economicsStatus: 'NOT_CONFIGURED',
    projections,
    assumptions: [...scenario.assumptions, NOT_CONFIGURED_ASSUMPTION],
  };
}

/**
 * Run a what-if scenario for a workspace.
 * @returns {Promise<(object|null)>} the scenario + memoryBasis, or null if no channels
 */
export async function runScenario(workspaceId, { change, now } = {}) {
  if (!workspaceId) throw new Error('runScenario: workspaceId required');

  const [{ channels }, { economics, isDefault }] = await Promise.all([
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
  // GOVERNING LAW: never dress a default-AOV number as a measurement. When economics
  // is unconfigured, blank the volume-derived projections to honest "—" (null ranges).
  const withStatus = withEconomicsStatus(scenario, isDefault);

  logger.info({ workspaceId, type: change?.type, patterns: memoryBasis.length, economicsStatus: withStatus.economicsStatus }, '[ScenarioService] projected');
  return { ...withStatus, memoryBasis };
}

/**
 * Build leading fatigue signals for a set of entities (reuse forecastFatigue).
 * @returns {Promise<Array<{signal, entityId, projectedBreachDate, daysToBreach, confidence}>>}
 */
export async function gatherLeadingSignals(workspaceId, { entityIds = [], now } = {}) {
  if (!workspaceId) throw new Error('gatherLeadingSignals: workspaceId required');
  if (entityIds.length === 0) return [];

  const since = new Date((now ? new Date(now).getTime() : Date.now()) - FATIGUE_SYNC_RECENCY_DAYS * 86_400_000);
  // The SAME canonical 30-day evidence the two fatigue services read (Phase K).
  // One selector, not a third inline window predicate — a leading signal and a
  // persisted prediction that disagreed about the period would be two different
  // claims about the same campaign wearing one name.
  const snapshots = await selectCanonicalFatigueSnapshots(workspaceId, { entityIds, since });

  // Day-collapsed by the sweep's own builder rather than by a private grouping.
  // This is a REQUIREMENT of canonical evidence, not tidying: `date` is the sync
  // timestamp, so two syncs on one day land two canonical rows hours apart. The
  // old `series.length < 2` check counted those as a trend and fitted a velocity
  // across minutes; buildEntitySeries keeps one point per UTC day and demands two
  // distinct days, which is the only spacing over which a 30-day level can move.
  const signals = [];
  for (const { entityId, series } of buildEntitySeries(snapshots)) {
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
