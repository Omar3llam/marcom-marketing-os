// ============================================================
// dailySnapshotSink — landing TRUE DAILY observations
// ============================================================
// Phase E / R8. Writes the DAILY population into `metric_snapshots` beside the
// rolling and canonical ones. Two things make it its own sink rather than a flag
// on landSnapshots, and both are worth stating before any code.
//
// ── 1. THE SHARED IDENTITY CANNOT EXPRESS A DAILY OBSERVATION ───────────────
//
// MetricSnapshot's unique key is
//     (entityId, entityLevel, date, granularity, source, measurementWindow)
// and `date` in it is the SYNC TIMESTAMP. One sync stamps ONE instant across the
// whole run, so seven days of one campaign arrive with seven different periods
// and ONE identical `date` — they collide, and an upsert on that key would fold
// a week into a single row. The key cannot be repaired for this population
// without breaking the others: `windowStart` is nullable (Google, GA4, MANUAL
// and every legacy row have none), and a nullable column in a unique index means
// NULL ≠ NULL, so adding it would silently stop de-duplicating every one of them.
//
// So the LOGICAL identity of a daily observation lives here instead:
//     (workspaceId, entityId, entityLevel, source, windowStart)   within DAILY
// enforced by a read-then-write, the same upsert-by-hand the outcome writer uses
// for the same reason (a natural key the schema cannot declare). What this does
// NOT give us is a database constraint: two syncs racing on the same workspace
// could each see no existing row and both create one. That is a documented
// residual, not an invisible one — a reader of this population must reduce
// latest-per-day rather than assume a single row, and closing it properly needs
// a PARTIAL unique index (`WHERE measurementWindow = 'DAILY'`), which Prisma
// cannot declare and which is deliberately left to the phase that adds the first
// reader.
//
// ── 2. IT DECORATES; IT NEVER MINTS ─────────────────────────────────────────
//
// landSnapshots upserts the whole entity graph. This sink writes snapshots ONLY
// for entities that already exist, exactly as actualsSink does for GA4 revenue.
// The daily fetch is campaign-level and runs after the operational sync in the
// same run, so its entities are already there; a daily row for an entity nobody
// has landed is dropped rather than used to conjure one. A population that
// cannot create entities cannot create phantoms.
//
// ── RESTATEMENT ─────────────────────────────────────────────────────────────
//
// Meta revises a day after the fact — conversions and revenue mature over the
// attribution window, spend adjusts for invalid traffic. Re-observing a day
// therefore UPDATES its row: the metrics become the latest reading and `date`
// advances to the observation that produced it. The consequence is explicit and
// must not be glossed: the previous reading is NOT retained, so this table can
// say what a day is now believed to have been and when we last looked, but not
// what we believed about it last week. Keeping every observation would multiply
// rows by the re-read depth on every sync; that trade belongs to whoever needs
// restatement history, and R8 does not.
//
// R8 SOLVES TEMPORAL GRANULARITY. IT DOES NOT SOLVE ATTRIBUTION MATURATION.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { toSnapshotRows } from './snapshotSink.js';
import { MEASUREMENT_WINDOW } from './connectorTypes.js';

/**
 * PURE: the logical identity of one daily observation.
 *
 * `source` is in the key because two platforms measuring the same campaign on
 * the same day are two measurements, not one — the same reason Phase F put
 * `measurementWindow` into the shared key. `entityLevel` is in it because the
 * id space is per-level by construction and a future non-campaign daily fetch
 * must not collide with this one.
 */
export function dailyKey({ entityId, entityLevel, source, windowStart }) {
  const t = windowStart instanceof Date ? windowStart : new Date(windowStart);
  return `${entityId}|${entityLevel}|${source}|${t.toISOString()}`;
}

/** The columns a re-observation may rewrite. Identity and period are NOT here. */
const RESTATEABLE = Object.freeze([
  'date', 'spendMinor', 'revenueMinor', 'cpaMinor', 'impressions', 'clicks',
  'conversions', 'ctr', 'roas', 'reach', 'frequency', 'actionMetrics',
  'dailyBudgetMinor', 'currency', 'currencyProvenance', 'windowEnd',
]);

/** PURE: the update payload for a re-observed day — never its identity. */
export function restatementData(row) {
  const out = {};
  for (const key of RESTATEABLE) if (row[key] !== undefined) out[key] = row[key];
  return out;
}

/**
 * Land daily observations for one workspace + channel.
 *
 * @param {string} workspaceId
 * @param {string} channel — CHANNEL enum value (for entity id derivation)
 * @param {Array} normalized — metaDailyNormalize output `.snapshots`
 * @returns {Promise<{ created:number, restated:number, skippedUnknownEntity:number }>}
 */
export async function landDailySnapshots(workspaceId, channel, normalized = []) {
  if (!workspaceId) throw new Error('landDailySnapshots: workspaceId required');
  if (!normalized.length) return { created: 0, restated: 0, skippedUnknownEntity: 0 };

  // The SAME row builder as every other population, deliberately reused: the
  // definitional ratios (ctr/roas/cpaMinor) are derived in exactly one place, so
  // a daily CTR is computed from that day's own clicks and impressions by the
  // code that computes every other CTR. It also enforces the measurementWindow
  // declaration — a row that failed to state its window throws there, not here.
  const rows = toSnapshotRows(workspaceId, channel, normalized);

  // Every row must be DAILY. Not a defensive nicety: this sink's whole identity
  // model assumes it, and a ROLLING_WINDOW row arriving here would be written
  // with a daily key and read as a day.
  const wrong = rows.find((r) => r.measurementWindow !== MEASUREMENT_WINDOW.DAILY);
  if (wrong) {
    throw new Error(
      `landDailySnapshots: refused a ${wrong.measurementWindow} row — this sink lands the DAILY population only, `
      + 'and relabelling a trailing aggregate as a day is the one thing this phase must never do',
    );
  }
  // A daily row without a period cannot be given a logical identity, and its
  // period is the only thing that makes it a daily observation at all.
  const undated = rows.find((r) => r.windowStart == null);
  if (undated) {
    throw new Error('landDailySnapshots: refused a row with no windowStart — a daily observation must carry the day it measured');
  }

  // ── Decorate-only: which of these entities actually exist HERE? ─────────
  // R9 (I33) — scoped to THIS workspace. The check answers "may I land a row on
  // this entity", and entity id alone answers a different question: "does this
  // entity exist anywhere". Existence in someone else's workspace is not
  // permission, and this sink writes canonical DAILY observations — the
  // population the comparability reader and the verdict window both draw from.
  //
  // Safe today only because detId derives the id FROM the workspace, so a
  // foreign id could not collide by accident. That is a property of one hashing
  // function, not a property of this query; the query now states the scope it
  // depends on instead of inheriting it.
  const entityIds = [...new Set(rows.map((r) => r.entityId))];
  const known = new Set(
    (await prisma.campaign.findMany({
      where: { id: { in: entityIds }, workspaceId }, select: { id: true },
    })).map((c) => c.id),
  );
  const landable = rows.filter((r) => known.has(r.entityId));
  const skippedUnknownEntity = rows.length - landable.length;
  if (skippedUnknownEntity > 0) {
    logger.warn(
      { workspaceId, channel, skippedUnknownEntity },
      '[dailySnapshotSink] dropped daily rows for entities the graph does not contain (this sink never mints entities)',
    );
  }
  if (landable.length === 0) return { created: 0, restated: 0, skippedUnknownEntity };

  // ── The logical-identity read (one query, no N+1) ───────────────────────
  const days = [...new Set(landable.map((r) => r.windowStart.getTime()))].map((t) => new Date(t));
  const existing = await prisma.metricSnapshot.findMany({
    where: {
      workspaceId,
      measurementWindow: MEASUREMENT_WINDOW.DAILY,
      entityId: { in: [...new Set(landable.map((r) => r.entityId))] },
      windowStart: { in: days },
    },
    // Named, not a SELECT *: this read wants an id and a key, and projecting the
    // whole row would widen on every column the table ever gains (#209).
    select: { id: true, entityId: true, entityLevel: true, source: true, windowStart: true },
  });
  const idByKey = new Map(existing.map((e) => [dailyKey(e), e.id]));

  // Partition FIRST, then build the operations — no query inside the loop. One
  // `$transaction` for the whole batch, exactly as landSnapshots does: a day is
  // not worth a round-trip of its own, and a partly-applied batch would leave a
  // week half-restated.
  const keyed = landable.map((row) => ({ row, id: idByKey.get(dailyKey(row)) ?? null }));
  const creations = keyed.filter((k) => k.id === null).map((k) => k.row);
  const restatements = keyed.filter((k) => k.id !== null);

  await prisma.$transaction([
    ...creations.map((row) => prisma.metricSnapshot.create({ data: row })),
    ...restatements.map(({ id, row }) => prisma.metricSnapshot.update({ where: { id }, data: restatementData(row) })),
  ]);
  const created = creations.length;
  const restated = restatements.length;

  logger.info(
    { workspaceId, channel, created, restated, skippedUnknownEntity, days: days.length },
    '[dailySnapshotSink] landed daily observations',
  );
  return { created, restated, skippedUnknownEntity };
}
