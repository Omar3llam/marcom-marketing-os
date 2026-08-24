// ============================================================
// nonDailySnapshotWrite — the ONE persistence mechanism for non-DAILY snapshots
// ============================================================
// B4-E4. Three writers — snapshotSink (operational + canonical), actualsSink
// (GA4) and RevenueCsvService (MANUAL) — used to reach the database through
// Prisma's generated compound-key upsert:
//
//     where: { entityId_entityLevel_date_granularity_source_measurementWindow: … }
//
// That selector is generated from the schema's `@@unique`, and Prisma emits it
// as `INSERT … ON CONFLICT (cols) DO UPDATE`. PostgreSQL refuses to match such a
// statement against a PARTIAL unique index unless the statement repeats the
// index predicate — and Prisma cannot emit a predicate. B4-E3 proved that
// directly: swapping the shipped index for a partial one made every one of those
// three writers fail with 42P10, "there is no unique or exclusion constraint
// matching the ON CONFLICT specification".
//
// So the partial index that DAILY needs cannot be created while these three
// depend on the generated selector. This module removes that dependency, and
// nothing else. The predicate is already here; the index it will one day match
// is NOT created by this slice, and the statement below is a no-op difference
// against the full index that ships today (a full index satisfies a predicated
// ON CONFLICT, which is exactly why this can land first and alone).
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
// It is not a general MetricSnapshot writer. DAILY has its own logical identity
// (workspaceId, entityId, entityLevel, source, windowStart) and its own sink,
// because the shared key cannot express an observed DAY — `date` in it is the
// SYNC timestamp. A DAILY row arriving here would be written under a mechanism
// built for a different identity, so it is refused rather than handled.
//
// ── THE TIMESTAMP CAST IS LOAD-BEARING ──────────────────────────────────────
// `date`, `windowStart` and `windowEnd` are `timestamp WITHOUT time zone`. An
// unqualified raw parameter binds as `timestamptz` and is then coerced in the
// SESSION timezone, so on a server at Africa/Cairo a 09:00Z instant stores as
// 12:00. Measured, not assumed (B4-E3):
//
//     Prisma typed client      09:00Z → stored 09:00
//     raw param, unqualified   09:00Z → stored 12:00     ← three hours adrift
//     raw param, cast to UTC   09:00Z → stored 09:00
//
// `date` is part of the write identity, so the shift is not merely a wrong
// value: a retry would no longer match the row Prisma wrote and would INSERT a
// duplicate instead of updating it. Every reader that ranks or buckets by `date`
// would move with it. Removing the cast is covered by a regression test that
// fails without it.
// ============================================================
import { Prisma } from '@prisma/client';
import { MEASUREMENT_WINDOW } from './connectorTypes.js';

/**
 * The identity this mechanism conflicts on — the shipped `@@unique`, unchanged.
 * Listed here so the statement below cannot drift from it silently.
 */
export const NON_DAILY_IDENTITY = Object.freeze([
  'entityId', 'entityLevel', 'date', 'granularity', 'source', 'measurementWindow',
]);

/**
 * Per-column SQL casts. PostgreSQL needs the enum type named for a text
 * parameter, `uuid` for the two id columns, and `jsonb` for the funnel bag.
 * The three timestamps are handled separately (see the header) because their
 * cast is a conversion, not just a type annotation.
 */
const CAST = Object.freeze({
  workspaceId: '::uuid',
  entityId: '::uuid',
  entityLevel: '::"EntityLevel"',
  source: '::"DataSource"',
  granularity: '::"Granularity"',
  measurementWindow: '::"MeasurementWindow"',
  actionMetrics: '::jsonb',
});

/** Columns stored as `timestamp WITHOUT time zone`. */
const TIMESTAMP_COLUMNS = new Set(['date', 'windowStart', 'windowEnd']);

/** PURE: the value expression for one column, with whatever cast it needs. */
function valueExpr(column, value) {
  if (TIMESTAMP_COLUMNS.has(column)) {
    // NOT a bare cast: `timestamptz AT TIME ZONE 'UTC'` converts the instant
    // into the UTC wall-clock reading Prisma's client stores, which a plain
    // `::timestamp` would not do.
    return Prisma.sql`${value == null ? null : new Date(value)}::timestamptz AT TIME ZONE 'UTC'`;
  }
  if (column === 'actionMetrics') {
    // Serialised here rather than handed over as an object: the raw parameter
    // path has no model to infer Json from. null stays null — a reader must be
    // able to tell "this channel reports no funnel" from "every stage was zero".
    return Prisma.sql`${value == null ? null : JSON.stringify(value)}::jsonb`;
  }
  const cast = CAST[column];
  return cast ? Prisma.sql`${value}${Prisma.raw(cast)}` : Prisma.sql`${value}`;
}

/** PURE: a quoted identifier. Column names come from this module, never input. */
const col = (name) => Prisma.raw(`"${name}"`);

/**
 * Persist ONE non-DAILY MetricSnapshot row, upserting on the shipped identity.
 *
 * Returns the PrismaPromise unawaited, so callers keep passing an array to
 * `prisma.$transaction([...])` exactly as they did with the generated upsert —
 * one atomic batch, one row's failure rolling the whole thing back.
 *
 * FIELD EQUIVALENCE. The old call was `{ create: r, update: r }`, and Prisma
 * SKIPS `undefined` on both sides: a column absent from the row keeps its
 * database default on insert and is LEFT ALONE on update. That is reproduced by
 * building the column list from the row's DEFINED keys only — actualsSink and
 * RevenueCsvService omit `reach`, `actionMetrics` and `dailyBudgetMinor`, and a
 * fixed `DO UPDATE SET` naming them would overwrite those columns with NULL on
 * every repeat. An explicit `null` in the row is a real value and still lands.
 *
 * @param {object} client — `prisma` or a `$transaction` client
 * @param {object} row — a full MetricSnapshot row, non-DAILY
 * @returns {Prisma.PrismaPromise<number>}
 */
export function upsertNonDailyMetricSnapshot(client, row) {
  if (!row || typeof row !== 'object') {
    throw new Error('upsertNonDailyMetricSnapshot: a row object is required');
  }
  if (!row.measurementWindow) {
    throw new Error(
      'upsertNonDailyMetricSnapshot: measurementWindow is required — a row that does not '
      + 'declare what period it measures cannot be given an identity here',
    );
  }
  // The contract, enforced rather than documented. DAILY has a different logical
  // identity and a different sink; letting one through here would write it under
  // a mechanism that cannot tell two observed days apart.
  if (row.measurementWindow === MEASUREMENT_WINDOW.DAILY) {
    throw new Error(
      'upsertNonDailyMetricSnapshot: refused a DAILY row — this mechanism conflicts on '
      + '(entityId, entityLevel, date, granularity, source, measurementWindow), and `date` is the '
      + 'SYNC timestamp, so every day of one sync would collide. DAILY belongs to dailySnapshotSink.',
    );
  }
  for (const key of NON_DAILY_IDENTITY) {
    if (row[key] === undefined || row[key] === null) {
      throw new Error(`upsertNonDailyMetricSnapshot: ${key} is part of the write identity and cannot be absent`);
    }
  }

  const columns = Object.keys(row).filter((k) => row[k] !== undefined);

  const insertCols = Prisma.join([col('id'), ...columns.map(col)], ', ');
  const insertVals = Prisma.join(
    [Prisma.sql`gen_random_uuid()`, ...columns.map((c) => valueExpr(c, row[c]))],
    ', ',
  );
  // Every defined column is restated from EXCLUDED, mirroring `update: r`. The
  // identity columns are included and are a no-op by construction — they are
  // what matched. `id` is deliberately absent: an update must not re-mint the
  // row's primary key.
  const updateSet = Prisma.join(
    columns.map((c) => Prisma.sql`${col(c)} = EXCLUDED.${col(c)}`),
    ', ',
  );

  return client.$executeRaw`
    INSERT INTO "metric_snapshots" (${insertCols})
    VALUES (${insertVals})
    ON CONFLICT ("entityId", "entityLevel", "date", "granularity", "source", "measurementWindow")
      WHERE "measurementWindow" <> 'DAILY'
    DO UPDATE SET ${updateSet}`;
}
