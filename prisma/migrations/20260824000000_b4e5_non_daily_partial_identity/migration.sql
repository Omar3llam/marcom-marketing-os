-- MetricSnapshot identity becomes PARTIAL — non-DAILY only (B4-E5).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The shipped identity is full-table:
--     (entityId, entityLevel, date, granularity, source, measurementWindow)
-- and `date` in it is the SYNC TIMESTAMP, not the period a row measures. One
-- sync stamps ONE instant across the whole run. For every population that
-- reports a trailing aggregate that is correct — one entity produces one row per
-- sync per window, and the key de-duplicates a re-sync onto it.
--
-- For the DAILY population it is fatal. Seven days of one campaign arrive from a
-- single sync with seven different periods and ONE identical `date`, differing
-- only in `windowStart` — which is not in the key. So they are not seven rows,
-- they are one row seven times. Measured on a migration-built PostgreSQL 18.4
-- (B4-E2): a three-day batch raises
--     P2002 · unique constraint "metric_snapshots_identity_key"
-- and, because the sink writes the batch in one transaction, 0 of 3 rows
-- persist. The daily pipeline has therefore never been able to store a second
-- day, and the failure is total rather than partial.
--
-- `windowStart` cannot be added to the key instead: it is nullable (Google, GA4,
-- MANUAL and every pre-Phase-C row have none), and NULL <> NULL inside a unique
-- index, so widening would silently stop de-duplicating all of them.
--
-- The identity is correct for the populations that have one. It is the DAILY
-- population that must be released from it — so the index becomes partial.
--
-- ── WHY THIS COULD NOT LAND EARLIER ─────────────────────────────────────────
--
-- Until B4-E4, three writers reached this table through Prisma's generated
-- compound-key upsert, which Prisma emits as `INSERT … ON CONFLICT (cols) DO
-- UPDATE`. PostgreSQL will not match that statement to a PARTIAL unique index
-- unless the statement repeats the index predicate, and Prisma cannot emit one.
-- B4-E3 proved it directly: creating this exact index while those writers were
-- still on the generated selector broke all three with
--     42P10 · there is no unique or exclusion constraint matching the
--             ON CONFLICT specification
-- B4-E4 moved snapshotSink, actualsSink and RevenueCsvService onto a raw upsert
-- that DOES carry the predicate. That is the only reason this migration is safe
-- to apply now, and the two must not be reordered.
--
-- ── WHAT OWNS DAILY IDENTITY AFTERWARDS ─────────────────────────────────────
--
-- dailySnapshotSink, which already enforces
--     (workspaceId, entityId, entityLevel, source, windowStart)  within DAILY
-- by a read-then-write — a natural key the schema cannot declare, because it is
-- meaningful for one measurementWindow value only. No replacement broad unique
-- constraint is created here: none is required for the sink to be correct, and
-- adding one would be a second identity model landing in the same slice as the
-- removal of the first. The residual it leaves — two syncs racing on the same
-- workspace could each see no row and both create one — is unchanged by this
-- migration, pre-dates it, and is documented at the head of that sink.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- Both steps are monotonic with respect to existing data:
--
--   · The partial index covers a SUBSET of the rows the full index covered, on
--     the SAME columns. Anything unique under the full key is unique under it,
--     so the build cannot fail on data already in the table.
--   · Dropping a unique index can only ADMIT rows that were previously
--     rejected. It cannot invalidate a row that already exists.
--
-- No row is read, rewritten, deleted, relabelled or re-keyed. No metric value,
-- `date`, `windowStart` or `measurementWindow` changes. No id is regenerated.
--
-- LOCK NOTE: this builds an index and briefly takes ACCESS EXCLUSIVE. The
-- production row count is unknown from here (the reachable DATABASE_URL is a
-- local database), so on a large table prefer running the CREATE UNIQUE INDEX
-- CONCURRENTLY form out-of-band first — this script's step 1 is written with
-- IF NOT EXISTS precisely so that it becomes a no-op when that has been done.
-- CONCURRENTLY cannot be used here because Prisma runs a migration as one
-- transactional script.
--
-- Idempotent: safe to re-run.

-- ── 1. The partial non-DAILY identity ───────────────────────────────────────
-- Created BEFORE the old one is dropped, so the non-DAILY population is never
-- momentarily unprotected.
--
-- The predicate text matches `upsertNonDailyMetricSnapshot` exactly. PostgreSQL
-- matches an ON CONFLICT to a partial index by proving the statement's predicate
-- implies the index's, so these two are one contract in two files.
CREATE UNIQUE INDEX IF NOT EXISTS "metric_snapshots_non_daily_identity_key"
  ON "metric_snapshots" ("entityId", "entityLevel", "date", "granularity", "source", "measurementWindow")
  WHERE "measurementWindow" <> 'DAILY';

-- ── 2. Retire the full-table identity ───────────────────────────────────────
--
-- Prisma's `@@unique` emits a bare UNIQUE INDEX, not a table CONSTRAINT —
-- verified again here against the 65-migration chain: pg_constraint holds no 'u'
-- row for this table while pg_indexes holds the index. So DROP CONSTRAINT alone
-- is a silent no-op that leaves the old key enforcing, which is exactly how the
-- first draft of 20260812000000 failed: it reported success and the collision it
-- was written to remove still fired.
--
-- Both forms are handled, because a database restored or hand-patched elsewhere
-- may legitimately hold the constraint-backed variant, and an index that BACKS a
-- constraint cannot be dropped with DROP INDEX.
DO $$
DECLARE
  target text;
BEGIN
  -- Constraint-backed variant first (DROP CONSTRAINT removes its index too).
  SELECT conname INTO target
  FROM pg_constraint
  WHERE conrelid = '"metric_snapshots"'::regclass
    AND contype = 'u'
    AND conname = 'metric_snapshots_identity_key'
  LIMIT 1;

  IF target IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "metric_snapshots" DROP CONSTRAINT %I', target);
    RETURN;
  END IF;

  -- Plain unique index (what Prisma actually creates, and what the chain built).
  --
  -- Qualified by current_schema(). Unqualified, this could read another schema's
  -- catalog row and then hand its NAME to a DROP that resolves through
  -- search_path back into this one — a mismatch that either drops the wrong
  -- object or fails. Production runs a single schema, so this changes nothing
  -- there; it makes the statement mean what it says.
  SELECT indexname INTO target
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND tablename = 'metric_snapshots'
    AND indexname = 'metric_snapshots_identity_key'
  LIMIT 1;

  IF target IS NOT NULL THEN
    EXECUTE format('DROP INDEX %I', target);
  END IF;
END
$$;

-- ── 3. Post-condition — fail loudly rather than report a false success ───────
--
-- Step 2 drops by NAME, and a name is an assumption about a database this
-- script cannot see. The production schema is known to have drifted from the
-- migration history in the past, so "the DROP matched nothing" is a real
-- outcome and it is indistinguishable from success without this check.
--
-- The check is name-independent: it asks whether ANY full-table unique index on
-- exactly those six columns still stands. The new partial index is excluded by
-- `indpred IS NULL`, and the primary key by its column list.
--
-- A migration that half-applies here would leave DAILY exactly as broken as it
-- is today while every deploy log said the fix had shipped.
DO $$
DECLARE
  leftover int;
  created  int;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'metric_snapshots'
    AND ix.indisunique AND NOT ix.indisprimary AND ix.indpred IS NULL
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM pg_attribute a
          WHERE a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey))
        = ARRAY['date','entityId','entityLevel','granularity','measurementWindow','source'];

  IF leftover > 0 THEN
    RAISE EXCEPTION
      'B4-E5: % full-table unique index(es) on the snapshot identity survived this migration. '
      'DAILY observations would still collide. Drop it by its actual name and re-run.', leftover;
  END IF;

  SELECT count(*) INTO created
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND tablename = 'metric_snapshots'
    AND indexname = 'metric_snapshots_non_daily_identity_key';

  IF created <> 1 THEN
    RAISE EXCEPTION
      'B4-E5: the partial non-DAILY identity index is missing after this migration. '
      'The non-DAILY population would be unprotected.';
  END IF;
END
$$;
