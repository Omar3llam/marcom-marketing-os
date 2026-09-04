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
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger }     from '../../utils/logger.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { fromMinor }  from '../../lib/money.js';
import { generateAgenda } from './testGeneratorEngine.js';
import { TEMPORAL }       from '../../config/temporal.js';

// Bounds MetricSnapshot.date — the SYNC timestamp, not a delivery horizon.
// Value unchanged (14).
const SYNC_RECENCY_DAYS = TEMPORAL.testGeneratorSyncRecencyDays;
const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
// The READ half of a cross-file contract: TestTracker writes
// DecisionMemoryEntry.actionType as `${TEST_ROOT_PREFIX}${dimension}` and this
// prefix is how those rows are found again. Exported so the two literals can be
// asserted equal — before R7 they were declared independently in two files with
// no test naming either, so renaming one would have silently stopped the
// generator from excluding dimensions already tested.
export const TEST_MEMORY_PREFIX = 'test:';

/**
 * Pure: fold platform MetricSnapshot rows into generator entity inputs.
 * Ratios derive from summed counts; frequency is the latest seen.
 * Exported for unit testing without a DB.
 *
 * @param {Array<object>} snapshots — MetricSnapshot rows
 * @param {Map<string,{name,currency,level}>} [labelsById]
 * @param {Map<string,string>} [verdictByEntity]
 * @returns {Array<object>} generator entity inputs
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
 * Pure: fold concluded-test memory rows into generator memory priors.
 * Exported for unit testing without a DB.
 *
 * @param {Array<object>} entries — DecisionMemoryEntry rows
 * @returns {Array<{entityId, dimension, outcome, isSustainable}>}
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
 * Build the ranked weekly testing agenda for a workspace. NO writes.
 * @returns {Promise<Array<object>>}
 */
export async function getWeeklyAgenda(workspaceId, { lookbackDays = SYNC_RECENCY_DAYS } = {}) {
  if (!workspaceId) throw new Error('getWeeklyAgenda: workspaceId required');
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const [snapshots, accounts, decisions, memory] = await Promise.all([
    // R3: this service no longer states where its evidence lives. The
    // operational population — workspace scope and the window allow-list Phase G
    // introduced — is declared once, in the Evidence layer, and asked for here.
    //
    // THE PROJECTION IS THE ONE INTENTIONAL CHANGE IN THIS MIGRATION. This read
    // was select-less, so Prisma returned every column of every row inside the
    // recency window — including `actionMetrics`, a JSON funnel blob nobody here
    // opens. The seam refuses an unprojected read by contract, because a shared
    // entry point is the worst place to leave that door open: the next column
    // added to MetricSnapshot would widen this query silently, which is exactly
    // how getLoopState went down when `aiInsight` landed.
    //
    // These ELEVEN fields are what buildEntityInputs actually reads, and no
    // snapshot row escapes it — the function emits a new shape. Each one has a
    // consumer below:
    //
    //   source                      the PLATFORM_SOURCES gate
    //   entityId                    grouping key and output field
    //   entityLevel, currency       the metadata FALLBACKS, and they are live:
    //                               labelsById is keyed off Account.id while
    //                               these rows are campaign-grain, so the lookup
    //                               misses on ordinary rows and the fallback is
    //                               what supplies both values
    //   spendMinor, revenueMinor    summed → roas, cpa, metrics.spendMinor
    //   impressions, clicks         summed → ctr
    //   conversions                 summed → cpa, metrics.conversions
    //   frequency                   latest-wins (per-audience, not additive)
    //   date                        the comparator that decides "latest"
    //
    // `ctr` and `roas` are DELIBERATELY ABSENT although the columns exist:
    // buildEntityInputs recomputes both from the summed counts, because a stored
    // per-row ratio is meaningless once rows are added together. Projecting them
    // would look thorough and change nothing.
    //
    // NO catch, NO orderBy, NO reduction — none of which this query ever had. A
    // read failure propagates, as it always has; turning it into an empty
    // evidence set would let the agenda report "nothing worth testing" about a
    // database it could not reach.
    selectOperationalSnapshots(workspaceId, {
      since,
      orderBy: null,
      select: {
        source: true, entityId: true, entityLevel: true, currency: true,
        spendMinor: true, revenueMinor: true, impressions: true, clicks: true,
        conversions: true, frequency: true, date: true,
      },
    }),
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true, channel: true } }),
    // Two fields, named: the loop below reads entityId and verdict only. This
    // read is UNBOUNDED (no take, no window), so a select-less version pulls
    // every reasoning blob the workspace has ever written to build a map of
    // latest-verdict-per-entity.
    prisma.decision.findMany({
      // C-10 — SIGNAL only. This builds latest-verdict-per-entity for the weekly
      // agenda, and the read is UNBOUNDED, so under a standing breach every
      // entity's "verdict" was whichever guardrail episode the sweep wrote last.
      where:   { workspaceId, ...scopeFor('test-generator/latest-verdict') },
      orderBy: { createdAt: 'desc' },
      select:  { entityId: true, verdict: true },
    }),
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
 * Persist picked suggestions as PROPOSED experiments + their variants.
 * Two createMany calls; explicit UUIDs link parent→children (no N+1).
 *
 * @param {string} workspaceId
 * @param {Array<object>} picks — suggestions from getWeeklyAgenda (must carry entityId)
 * @returns {Promise<{ created: number, variants: number, testIds: string[] }>}
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
