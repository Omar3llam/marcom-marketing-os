// ============================================================
// PatternService — persistence wrapper for the pattern engine
// ============================================================
// Owns DB I/O (the deterministic patternEngine never touches it).
//   getBriefing(): read the workspace's own history → extractPatterns →
//   persist AccountPattern rows (keyed by deterministic patternKey) +
//   their PatternObservation audit trail, then return the briefing.
//
// Writes are bounded (no N+1): explicit UUIDs let one createMany insert
// new patterns; a single $transaction(updates.map(...)) refreshes existing
// ones; one createMany({skipDuplicates}) appends new observations.
// ============================================================
import { randomUUID } from 'crypto';
import { prisma }      from '../../lib/prisma.js';
import { logger }      from '../../utils/logger.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { extractPatterns } from './patternEngine.js';
import { PATTERN_STATUS }   from './patternTypes.js';
import { TEMPORAL }         from '../../config/temporal.js';

// Bounds MetricSnapshot.date — the SYNC timestamp, not a delivery horizon. A row
// written yesterday may hold a lifetime aggregate. Value unchanged (365).
const SYNC_RECENCY_DAYS = TEMPORAL.patternSyncRecencyDays;

/**
 * Pure: map prisma rows into the pattern engine's input arrays.
 * Exported for unit testing without a DB.
 */
export function buildPatternInputs({ decisions = [], outcomes = [], snapshots = [], tests = [] }) {
  return {
    decisions: decisions.map((d) => ({
      id: d.id, entityId: d.entityId, entityLevel: d.entityLevel,
      verdict: d.verdict, audienceTag: d.audienceTag ?? null, createdAt: d.createdAt,
    })),
    outcomes: outcomes.map((o) => ({ decisionId: o.decisionId, sustained: o.sustained })),
    snapshots: snapshots.map((s) => ({
      entityId: s.entityId, date: s.date, frequency: s.frequency, roas: s.roas,
      ctr: s.ctr, spendMinor: s.spendMinor,
    })),
    tests: tests.map((t) => ({
      id: t.id, entityId: t.entityId, dimension: t.dimension, status: t.status,
      winnerLabel: t.winnerLabel, confidenceLabel: t.confidenceLabel,
      concludedAt: t.concludedAt, createdAt: t.createdAt,
    })),
  };
}

// Columns refreshed on every extraction (truth/recency move over time).
function dynamicFields(p) {
  return {
    statement: p.statement, basis: p.basis ?? null,
    support: p.support, effectiveSupport: p.effectiveSupport, accuracy: p.accuracy,
    confidence: p.confidence, status: p.status, threshold: p.threshold ?? null,
    lastObservedAt: p.lastObservedAt,
  };
}

/**
 * Extract + persist this workspace's patterns and return the briefing.
 * @returns {Promise<{ patterns, promotableCount, conflicts }>}
 */
export async function getBriefing(workspaceId, { now = new Date(), lookbackDays = SYNC_RECENCY_DAYS } = {}) {
  if (!workspaceId) throw new Error('getBriefing: workspaceId required');
  const since = new Date(now.getTime() - lookbackDays * 86_400_000);

  const [decisions, snapshots, tests] = await Promise.all([
    // Explicit select, for the reason the MetricSnapshot read below already
    // documents — this one was the exception beside it. buildPatternInputs uses
    // exactly these five fields, and the two reasoning JSONB columns on Decision
    // would otherwise ride along on an unbounded lookback window that never
    // reads them.
    prisma.decision.findMany({
      where:  { workspaceId, createdAt: { gte: since } },
      select: {
        id: true, verdict: true, entityId: true, entityLevel: true, createdAt: true,
      },
    }),
    // R3: this service no longer knows how to find its evidence — it asks. The
    // operational population (workspace scope, the LEGACY_UNKNOWN/ROLLING_WINDOW
    // allow-list, and the sync-recency bound) is now stated once, in the Evidence
    // layer, rather than inline here.
    //
    // WHY OPERATIONAL, unchanged (Phase G): pattern extraction reads these as a
    // sequence of observations per entity, so a canonical row is an extra
    // observation of a period nobody asked about.
    //
    // `since` is derived from the CALLER's lookbackDays, not from the config
    // default — getBriefing's parameter stays authoritative and the Evidence
    // layer receives whatever it resolved to.
    //
    // orderBy: null — this query never had one, and it must not acquire one.
    // patternEngine.indexSnapshots sorts each entity's series itself, so the
    // database was never asked to; adding ORDER BY to the widest lookback in the
    // system (365 days) changes the plan without changing a single output.
    //
    // The projection stays HERE, named by the consumer that reads it:
    // buildPatternInputs projects exactly these six fields. Explicit, not
    // `SELECT *` — a new MetricSnapshot column would otherwise widen this read
    // and throw during migration lag (the class that took getLoopState down
    // in #209).
    selectOperationalSnapshots(workspaceId, {
      since,
      select: { entityId: true, date: true, frequency: true, roas: true, ctr: true, spendMinor: true },
      orderBy: null,
    }),
    prisma.testExperiment.findMany({ where: { workspaceId } }),
  ]);
  const outcomes = decisions.length
    ? await prisma.outcomeSnapshot.findMany({ where: { workspaceId, decisionId: { in: decisions.map((d) => d.id) } } })
    : [];

  const inputs = buildPatternInputs({ decisions, outcomes, snapshots, tests });
  const patterns = extractPatterns({ ...inputs, now });

  // Map patternKey → stable row id (existing or freshly assigned).
  const existing = await prisma.accountPattern.findMany({ where: { workspaceId } });
  const idByKey = new Map(existing.map((r) => [r.patternKey, r.id]));
  for (const p of patterns) if (!idByKey.has(p.key)) idByKey.set(p.key, randomUUID());

  const newRows = [];
  const updates = [];
  for (const p of patterns) {
    const id = idByKey.get(p.key);
    const supersededById = p.supersededByKey ? idByKey.get(p.supersededByKey) ?? null : null;
    if (existing.find((r) => r.patternKey === p.key)) {
      updates.push(prisma.accountPattern.update({ where: { id }, data: { ...dynamicFields(p), supersededById } }));
    } else {
      newRows.push({
        id, workspaceId, patternKey: p.key, kind: p.kind, ...dynamicFields(p),
        metric: p.metric ?? null, scopeLevel: p.scopeLevel ?? null, audienceTag: p.audienceTag ?? null,
        comparator: p.comparator ?? null, unit: p.unit ?? null, emitVerdict: p.emitVerdict ?? null,
        sustainedDays: p.sustainedDays ?? null, supersededById,
        firstObservedAt: p.firstObservedAt, lastObservedAt: p.lastObservedAt,
      });
    }
  }

  const observationRows = patterns.flatMap((p) =>
    (p.observations ?? []).map((o) => ({
      workspaceId, patternId: idByKey.get(p.key), occurrenceKey: o.occurrenceKey,
      decisionId: o.decisionId ?? null, entityId: o.entityId ?? null,
      predicted: o.predicted, actual: o.actual ?? null, correct: o.correct ?? null,
      observedAt: o.observedAt,
    })),
  );

  if (newRows.length) await prisma.accountPattern.createMany({ data: newRows });
  if (updates.length) await prisma.$transaction(updates);
  if (observationRows.length) await prisma.patternObservation.createMany({ data: observationRows, skipDuplicates: true });

  const enriched = patterns.map((p) => ({ id: idByKey.get(p.key), ...p }));
  const promotableCount = enriched.filter((p) => p.promotable).length;
  const conflicts = enriched.filter((p) => p.status === PATTERN_STATUS.CONFLICTED);

  logger.info({ workspaceId, patterns: enriched.length, promotableCount, conflicts: conflicts.length }, '[PatternService] briefing built');
  return { patterns: enriched, promotableCount, conflicts };
}
