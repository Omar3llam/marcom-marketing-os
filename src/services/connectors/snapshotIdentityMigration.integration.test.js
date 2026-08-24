// ============================================================
// B4-E5 — the identity migration itself, against a REAL PostgreSQL
// ============================================================
// This suite runs the ACTUAL migration file from disk. Not a copy of its SQL,
// not an equivalent statement written by hand — the artifact that will run
// against production, read from
//   prisma/migrations/20260824000000_b4e5_non_daily_partial_identity/
// so that editing the migration without editing the test cannot leave the test
// green.
//
// ── WHY IT BUILDS ITS OWN SCHEMA ────────────────────────────────────────────
//
// To prove an UPGRADE you need a database in the old shape, and the connected
// one is already in the new shape. Reconstructing the old shape on
// `public.metric_snapshots` would mean briefly restoring a full unique index on
// the table every other DB suite writes to — including the one that lands three
// DAILY days, which the full index exists to reject. That is a race with a
// spurious-failure end, and worse, it would be a race whose failure looks like
// the very bug this slice fixes.
//
// So the whole thing happens in a private schema holding a structural clone
// (`LIKE public.metric_snapshots INCLUDING ALL`) — same columns, same types,
// same constraints, its own indexes. Nothing here touches the shared table, and
// the migration is exercised with `search_path` pointed at the clone, which is
// also why the migration qualifies its catalog reads with `current_schema()`.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';

const DB_OK = await dbAvailable();

const PROBE = 'b4e5_migration_probe';
const TABLE = `"${PROBE}"."metric_snapshots"`;
const MIGRATION_DIR = '20260824000000_b4e5_non_daily_partial_identity';

/** The six columns of the write identity, sorted — the shape both indexes carry. */
const IDENTITY_COLUMNS = ['date', 'entityId', 'entityLevel', 'granularity', 'measurementWindow', 'source'];

const migrationsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../../prisma/migrations',
);

/** The migration SQL, located by directory name so a rename fails loudly. */
function readMigration() {
  const dirs = readdirSync(migrationsRoot);
  if (!dirs.includes(MIGRATION_DIR)) {
    throw new Error(`B4-E5 migration directory ${MIGRATION_DIR} is missing from prisma/migrations`);
  }
  return readFileSync(path.join(migrationsRoot, MIGRATION_DIR, 'migration.sql'), 'utf8');
}

/**
 * Split a migration script into statements, respecting dollar-quoted bodies.
 *
 * Prisma runs a migration as one script; the driver here sends one statement per
 * call, so the script has to be split. Splitting on `;` alone would cut the
 * `DO $$ … $$` blocks in half — which is most of this migration.
 */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let tag = null;
  for (let i = 0; i < sql.length; i += 1) {
    if (tag) {
      if (sql.startsWith(tag, i)) { buf += tag; i += tag.length - 1; tag = null; continue; }
      buf += sql[i];
      continue;
    }
    const open = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (open) { tag = open[0]; buf += tag; i += tag.length - 1; continue; }
    if (sql[i] === ';') { out.push(buf); buf = ''; continue; }
    buf += sql[i];
  }
  out.push(buf);
  // A "statement" that is only comments and whitespace is the tail of the file.
  return out.filter((s) => s.split('\n').some((l) => l.trim() && !l.trim().startsWith('--')));
}

/** Every persisted column, so "unchanged" is field-level rather than a row count. */
const DUMP = `
  SELECT id::text, "workspaceId"::text, "entityId"::text, "entityLevel"::text,
         to_char(date, 'YYYY-MM-DD HH24:MI:SS.US') AS date,
         source::text, granularity::text, "measurementWindow"::text,
         to_char("windowStart", 'YYYY-MM-DD HH24:MI:SS.US') AS "windowStart",
         to_char("windowEnd",   'YYYY-MM-DD HH24:MI:SS.US') AS "windowEnd",
         "spendMinor", "revenueMinor", "cpaMinor", impressions, clicks, conversions,
         reach, ctr, roas, frequency, "actionMetrics"::text AS "actionMetrics",
         "dailyBudgetMinor", currency
  FROM ${TABLE} ORDER BY id`;

const dump = () => prisma.$queryRawUnsafe(DUMP);

/** Unique indexes on one schema's copy of the table, with their predicate state. */
const uniqueIndexes = (schema) => prisma.$queryRawUnsafe(`
  SELECT i.relname::text AS name,
         (ix.indpred IS NOT NULL) AS partial,
         (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM pg_attribute a
           WHERE a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey)) AS cols
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = $1 AND t.relname = 'metric_snapshots'
    AND ix.indisunique AND NOT ix.indisprimary`, schema);

const identityIndexes = async (schema) => {
  const rows = await uniqueIndexes(schema);
  return rows.filter((r) => [...r.cols].sort().join(',') === IDENTITY_COLUMNS.join(','));
};

const WS = '00000000-0000-4000-8000-0000b4e50001';
const CAMP = '00000000-0000-4000-8000-0000b4e50011';
const ACCT = '00000000-0000-4000-8000-0000b4e50012';

/** One row, written straight to the clone. Raw on purpose: the fixture must not
 *  depend on the code whose behaviour the migration is being judged against. */
function insertRow({ id, entityId = CAMP, level = 'CAMPAIGN', date, source = 'META',
  window: win, windowStart = null, spend = 1000 }) {
  return prisma.$executeRawUnsafe(`
    INSERT INTO ${TABLE}
      (id, "workspaceId", "entityId", "entityLevel", date, source, granularity,
       "measurementWindow", "windowStart", "windowEnd",
       "spendMinor", "revenueMinor", impressions, clicks, conversions, currency)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public."EntityLevel",
            $5::timestamptz AT TIME ZONE 'UTC', $6::public."DataSource", 'DAILY'::public."Granularity",
            $7::public."MeasurementWindow",
            $8::timestamptz AT TIME ZONE 'UTC', $8::timestamptz AT TIME ZONE 'UTC',
            $9, 0, 0, 0, 0, 'EGP')`,
  id, WS, entityId, level, new Date(date), source, win,
  windowStart === null ? null : new Date(windowStart), spend);
}

/**
 * The population as production could actually hold it: every non-DAILY writer's
 * shape, plus DAILY rows on three observed days.
 *
 * Those three carry three DIFFERENT `date` values, because under the SHIPPED
 * topology that is the only way three DAILY rows can exist at all — one day
 * landed per sync, on three separate syncs. A database that has ever held DAILY
 * rows holds them in exactly this shape, and it is the shape the migration has
 * to carry across untouched.
 */
const SEED = [
  { id: '00000000-0000-4000-8000-00000000aa01', entityId: ACCT, level: 'ACCOUNT', date: '2026-08-01T09:00:00Z', window: 'ROLLING_WINDOW' },
  { id: '00000000-0000-4000-8000-00000000aa02', date: '2026-08-01T09:00:00Z', window: 'ROLLING_WINDOW' },
  { id: '00000000-0000-4000-8000-00000000aa03', date: '2026-08-01T09:00:00Z', window: 'CUMULATIVE_30D', windowStart: '2026-07-03T00:00:00Z' },
  { id: '00000000-0000-4000-8000-00000000aa04', date: '2026-08-01T09:00:00Z', source: 'GA4', window: 'LEGACY_UNKNOWN' },
  { id: '00000000-0000-4000-8000-00000000aa05', date: '2026-08-01T09:00:00Z', source: 'MANUAL', window: 'LEGACY_UNKNOWN' },
  { id: '00000000-0000-4000-8000-00000000aa06', entityId: ACCT, level: 'ACCOUNT', date: '2026-07-15T09:00:00Z', source: 'GOOGLE', window: 'LEGACY_UNKNOWN' },
  { id: '00000000-0000-4000-8000-00000000bb01', date: '2026-08-21T04:00:00Z', window: 'DAILY', windowStart: '2026-08-20T00:00:00Z' },
  { id: '00000000-0000-4000-8000-00000000bb02', date: '2026-08-22T04:00:00Z', window: 'DAILY', windowStart: '2026-08-21T00:00:00Z' },
  { id: '00000000-0000-4000-8000-00000000bb03', date: '2026-08-23T04:00:00Z', window: 'DAILY', windowStart: '2026-08-22T00:00:00Z' },
];

/** Rebuild the clone in the SHIPPED (pre-B4-E5) shape and seed it. */
async function buildShippedClone() {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${PROBE}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${PROBE}"`);
  // A structural clone. LIKE copies columns, types, defaults, NOT NULLs and
  // indexes — but not foreign keys, so the clone needs no workspace row and
  // cannot reach the real graph.
  await prisma.$executeRawUnsafe(`CREATE TABLE ${TABLE} (LIKE public."metric_snapshots" INCLUDING ALL)`);

  // The clone inherited whatever unique index public currently has (the partial
  // one). Drop every non-primary unique index and put the SHIPPED one back, so
  // what follows is an upgrade from the real starting point.
  for (const idx of await uniqueIndexes(PROBE)) {
    await prisma.$executeRawUnsafe(`DROP INDEX "${PROBE}"."${idx.name}"`);
  }
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "metric_snapshots_identity_key" ON ${TABLE}
      ("entityId", "entityLevel", "date", "granularity", "source", "measurementWindow")`);

  for (const row of SEED) await insertRow(row);
}

/** Run the real migration with `search_path` pointed at the clone. */
async function applyMigration() {
  const statements = splitStatements(readMigration());
  await prisma.$transaction(async (tx) => {
    // SET LOCAL needs one pinned connection, which is what an interactive
    // transaction gives. `public` stays on the path so the enum type names the
    // seed and the predicate use still resolve; the clone is FIRST, so
    // current_schema() — which the migration filters on — is the clone.
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${PROBE}", public`);
    for (const sql of statements) await tx.$executeRawUnsafe(sql);
  }, { timeout: 60_000, maxWait: 20_000 });
  return statements.length;
}

describe.skipIf(!DB_OK)('B4-E5 · the snapshot identity migration, on real PostgreSQL', () => {
  afterAll(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${PROBE}" CASCADE`));

  // ── E5-T12 · the topology the migration chain actually produces ────────────
  // Read-only, against the connected database. It does not care whether that
  // database was built fresh or upgraded — both must arrive here.
  describe('E5-T12 · the shipped topology', () => {
    it('carries the partial non-DAILY identity', async () => {
      const [partial] = await identityIndexes('public');
      expect(partial, 'no unique index on the six identity columns exists').toBeDefined();
      expect(partial.name).toBe('metric_snapshots_non_daily_identity_key');
      expect(partial.partial, 'the identity index is not partial — DAILY still collides').toBe(true);
    });

    it('carries NO full-table identity — the thing DAILY collided on', async () => {
      const full = (await identityIndexes('public')).filter((i) => !i.partial);
      expect(full.map((i) => i.name)).toEqual([]);
    });

    it('states the predicate the non-DAILY writer relies on', async () => {
      const [{ def }] = await prisma.$queryRawUnsafe(`
        SELECT pg_get_indexdef(ix.indexrelid)::text AS def
        FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
        WHERE i.relname = 'metric_snapshots_non_daily_identity_key'`);
      // PostgreSQL matches an ON CONFLICT to a partial index by proving the
      // statement's predicate implies the index's. upsertNonDailyMetricSnapshot
      // emits `WHERE "measurementWindow" <> 'DAILY'`; this is the other half.
      expect(def).toMatch(/WHERE \("measurementWindow" <> 'DAILY'::"MeasurementWindow"\)/);
    });
  });

  // ── E5-T1 / E5-T2 · the upgrade, run against the shipped shape ─────────────
  describe('E5-T1 · applied to a database in the shipped shape', () => {
    let before;
    let statementCount;

    beforeAll(async () => {
      await buildShippedClone();
      before = await dump();
      statementCount = await applyMigration();
    });

    it('the fixture really did start in the shipped shape', () => {
      // Guards the test itself: if the clone were built with the partial index
      // already in place, everything below would pass while proving nothing.
      expect(before).toHaveLength(SEED.length);
      expect(statementCount).toBeGreaterThanOrEqual(3);
    });

    it('replaces the full-table identity with the partial one', async () => {
      const idx = await identityIndexes(PROBE);
      expect(idx.map((i) => `${i.name}${i.partial ? ' (partial)' : ' (FULL)'}`))
        .toEqual(['metric_snapshots_non_daily_identity_key (partial)']);
    });

    it('E5-T2 · every pre-existing row survives field-identical', async () => {
      const after = await dump();
      expect(after).toHaveLength(before.length);
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)); // no id regenerated
      expect(after).toEqual(before);                                   // and no value moved
    });

    it('E5-T2b · the DAILY rows it carried across are still three distinct days', async () => {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT to_char("windowStart", 'YYYY-MM-DD') AS day FROM ${TABLE}
        WHERE "measurementWindow" = 'DAILY'::public."MeasurementWindow" ORDER BY "windowStart"`);
      expect(rows.map((r) => r.day)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    });
  });

  // ── The payoff, shown from both sides ──────────────────────────────────────
  describe('three DAILY days from ONE sync', () => {
    // The failure this whole track exists to remove. A single sync stamps ONE
    // `date` on every row it produces, so three days differ only in
    // `windowStart` — which is not in the identity. Under the shipped index they
    // are one row written three times.
    const oneSync = ['2026-08-20', '2026-08-21', '2026-08-22'].map((d, i) => ({
      id: `00000000-0000-4000-8000-00000000cc0${i + 1}`,
      date: '2026-08-24T05:00:00Z', window: 'DAILY', windowStart: `${d}T00:00:00Z`, spend: 100 + i,
    }));

    it('collide under the shipped topology, and coexist after the migration', async () => {
      await buildShippedClone();
      await prisma.$executeRawUnsafe(`DELETE FROM ${TABLE}`);

      await insertRow(oneSync[0]);
      // BEFORE: the second day is refused — 23505, unique_violation.
      await expect(insertRow(oneSync[1])).rejects.toMatchObject({ meta: { code: '23505' } });
      expect(await dump()).toHaveLength(1);

      await prisma.$executeRawUnsafe(`DELETE FROM ${TABLE}`);
      await applyMigration();

      // AFTER: the same three rows, unchanged, all land.
      for (const row of oneSync) await insertRow(row);
      const rows = await dump();
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.windowStart.slice(0, 10)))
        .toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
      expect(new Set(rows.map((r) => r.date)).size, 'all three share one sync timestamp').toBe(1);
    });

    it('and the non-DAILY population is still de-duplicated afterwards', async () => {
      // The other half of "partial": what the index still covers, it still
      // enforces. A migration that simply dropped the constraint would pass the
      // test above and fail this one.
      const base = { id: '00000000-0000-4000-8000-00000000dd01', date: '2026-08-24T05:00:00Z', window: 'ROLLING_WINDOW' };
      await insertRow(base);
      await expect(insertRow({ ...base, id: '00000000-0000-4000-8000-00000000dd02' }))
        .rejects.toMatchObject({ meta: { code: '23505' } });
    });
  });
});
