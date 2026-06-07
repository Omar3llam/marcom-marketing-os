// ============================================================
// TestGeneratorService — persistence wrapper for the generator
// ============================================================
// Owns DB I/O (the deterministic testGeneratorEngine never touches it).
//   getWeeklyAgenda(): MetricSnapshots + verdicts + memory → ranked
//                      agenda (NO writes).
//   commitAgenda():    persist picked suggestions as PROPOSED
//                      TestExperiment rows + their TestVariant rows via
//                      two createMany calls (explicit UUIDs link parent
//                      to children — no N+1, no per-row loop write).
//
// The memory term is the loop closing: concluded-test outcomes are read
// back from DecisionMemoryEntry (`actionType: test:<DIMENSION>`) and
// bend the next agenda's ranking.
// ============================================================
import { randomUUID } from 'crypto';
import { prisma }     from '../../lib/prisma.js';
import { logger }     from '../../utils/logger.js';
import { fromMinor }  from '../../lib/money.js';
import { generateAgenda } from './testGeneratorEngine.js';

const LOOKBACK_DAYS    = Number(process.env.TEST_GENERATOR_LOOKBACK_DAYS || 14);
const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
const TEST_MEMORY_PREFIX = 'test:';

/**
 * Aggregate platform MetricSnapshot rows into generator-ready entity inputs.
 *
 * Each output entry represents one entity with summed numeric totals and derived metrics;
 * CTR and ROAS are computed from aggregated counts, CPA uses aggregated spend converted to major units,
 * and frequency uses the latest observed snapshot value.
 *
 * @param {Array<object>} snapshots - MetricSnapshot rows; only rows with supported platform sources are considered.
 * @param {Map<string,{name?:string,currency?:string,level?:string}>} [labelsById] - Optional lookup to override an entity's name, currency, and level.
 * @param {Map<string,string>} [verdictByEntity] - Optional lookup of precomputed verdicts by entityId; if missing, verdict defaults to `'HOLD'`.
 * @returns {Array<object>} Array of entity inputs with shape: { entityId, name, level, currency, verdict, metrics }
 * where `metrics` contains: { ctr, roas, frequency, cpa, conversions, spendMinor }.
 */
export function buildEntityInputs(snapshots, labelsById = new Map(), verdictByEntity = new Map()) {
  const byEntity = new Map();
  for (const s of snapshots) {
    if (!PLATFORM_SOURCES.has(s.source)) continue; // platform delivery only
    if (!byEntity.has(s.entityId)) {
      const meta = labelsById.get(s.entityId) || {};
      byEntity.set(s.entityId, {
        entityId: s.entityId,
        name:     meta.name ?? s.entityId,
        level:    meta.level ?? s.entityLevel ?? null,
        currency: meta.currency ?? s.currency ?? 'USD',
        spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
        frequency: 0, _freqDate: null,
      });
    }
    const e = byEntity.get(s.entityId);
    e.spendMinor   += s.spendMinor ?? 0;
    e.revenueMinor += s.revenueMinor ?? 0;
    e.impressions  += s.impressions ?? 0;
    e.clicks       += s.clicks ?? 0;
    e.conversions  += s.conversions ?? 0;
    // latest frequency wins (frequency is per-audience, not additive)
    if (s.frequency != null && (e._freqDate === null || s.date > e._freqDate)) {
      e.frequency = s.frequency; e._freqDate = s.date;
    }
  }

  return [...byEntity.values()].map((e) => {
    const spendMajor = fromMinor(e.spendMinor, e.currency);
    return {
      entityId: e.entityId,
      name:     e.name,
      level:    e.level,
      currency: e.currency,
      verdict:  verdictByEntity.get(e.entityId) ?? 'HOLD',
      metrics: {
        ctr:         e.impressions > 0 ? (e.clicks / e.impressions) * 100 : 0,
        roas:        e.spendMinor  > 0 ? e.revenueMinor / e.spendMinor    : 0,
        frequency:   e.frequency,
        cpa:         e.conversions > 0 ? spendMajor / e.conversions       : 0,
        conversions: e.conversions,
        spendMinor:  e.spendMinor,
      },
    };
  });
}

/**
 * Converts decision memory entries whose actionType starts with "test:" into generator memory priors.
 *
 * @param {Array<object>} entries - DecisionMemoryEntry rows to convert; entries with an actionType not starting with "test:" are ignored.
 * @returns {Array<{entityId: string, dimension: string, outcome: string|null, isSustainable: boolean|null}>} An array of memory priors containing the entityId, the dimension (the actionType suffix after "test:"), outcome (rationale or `null`), and isSustainable (boolean or `null`).
 */
export function buildMemoryInputs(entries) {
  return entries
    .filter((m) => typeof m.actionType === 'string' && m.actionType.startsWith(TEST_MEMORY_PREFIX))
    .map((m) => ({
      entityId:      m.entityId,
      dimension:     m.actionType.slice(TEST_MEMORY_PREFIX.length),
      outcome:       m.rationale ?? null,
      isSustainable: m.isSustainable ?? null,
    }));
}

/**
 * Builds a ranked weekly testing agenda for the given workspace.
 *
 * @param {string} workspaceId - Workspace identifier to build the agenda for.
 * @param {{lookbackDays?: number}} [options] - Optional settings.
 * @param {number} [options.lookbackDays=LOOKBACK_DAYS] - Number of days to look back when collecting metrics.
 * @returns {Array<object>} An array of agenda item objects ordered by rank.
 * @throws {Error} If `workspaceId` is not provided.
 */
export async function getWeeklyAgenda(workspaceId, { lookbackDays = LOOKBACK_DAYS } = {}) {
  if (!workspaceId) throw new Error('getWeeklyAgenda: workspaceId required');
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const [snapshots, accounts, decisions, memory] = await Promise.all([
    prisma.metricSnapshot.findMany({ where: { workspaceId, date: { gte: since } } }),
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true, channel: true } }),
    prisma.decision.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } }),
    prisma.decisionMemoryEntry.findMany({
      where:   { workspaceId, actionType: { startsWith: TEST_MEMORY_PREFIX } },
      orderBy: { createdAt: 'desc' },
      take:    200,
    }),
  ]);

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } });
  const labelsById = new Map(accounts.map((a) => [a.id, { name: a.name, currency: ws?.currency, level: 'CAMPAIGN' }]));
  const verdictByEntity = new Map();
  for (const d of decisions) if (!verdictByEntity.has(d.entityId)) verdictByEntity.set(d.entityId, d.verdict);

  const entities = buildEntityInputs(snapshots, labelsById, verdictByEntity);
  const agenda   = generateAgenda({ entities, memory: buildMemoryInputs(memory) });
  logger.info({ workspaceId, suggestions: agenda.length }, '[TestGeneratorService] agenda built');
  return agenda;
}

/**
 * Create proposed test experiments and their variants from agenda picks.
 *
 * Filters out invalid picks, generates UUIDs for each test, persists experiments and their variants together, and returns creation counts and generated test IDs.
 *
 * @param {string} workspaceId - Workspace identifier; required.
 * @param {Array<object>} picks - Agenda picks to persist. Each pick must include `entityId` and `dimension`; `variants` may be provided as an array of variant objects.
 * @returns {{ created: number, variants: number, testIds: string[] }} Counts of created tests and variants and the list of generated test IDs.
 */
export async function commitAgenda(workspaceId, picks = []) {
  if (!workspaceId) throw new Error('commitAgenda: workspaceId required');
  const valid = picks.filter((p) => p && p.entityId && p.dimension);
  if (valid.length === 0) return { created: 0, variants: 0, testIds: [] };

  const tests = valid.map((p) => ({
    id:             randomUUID(),
    workspaceId,
    entityId:       p.entityId,
    entityLevel:    p.entityLevel ?? 'CAMPAIGN',
    dimension:      p.dimension,
    hypothesis:     p.hypothesis ?? '',
    metric:         p.metric,
    expectedSignal: p.expectedSignal ?? '',
    priority:       p.priority ?? 0,
    currency:       p.currency ?? 'USD',
    status:         'PROPOSED',
  }));

  const variants = valid.flatMap((p, i) =>
    (p.variants ?? []).map((v) => ({
      testId:      tests[i].id,
      label:       v.label,
      description: v.description ?? '',
      isControl:   !!v.isControl,
    })),
  );

  await prisma.$transaction([
    prisma.testExperiment.createMany({ data: tests }),
    prisma.testVariant.createMany({ data: variants }),
  ]);

  logger.info({ workspaceId, created: tests.length, variants: variants.length }, '[TestGeneratorService] agenda committed');
  return { created: tests.length, variants: variants.length, testIds: tests.map((t) => t.id) };
}
