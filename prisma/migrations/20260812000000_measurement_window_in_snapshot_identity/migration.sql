-- MetricSnapshot identity gains `measurementWindow` (Phase F).
--
-- WHY: ConnectorSyncService stamps ONE `date` on an entire sync run, so a
-- canonical 30-day row and the operational rolling row produced by the same run
-- share every column of the old key:
--     (entityId, entityLevel, date, granularity, source)
-- and the sinks UPSERT rather than insert — so the collision is SILENT. The
-- second write overwrites the first, and which one survives is decided by
-- ordering. A canonical row losing a race to a 90-day row is exactly the defect
-- this track exists to remove, so the two must be separately addressable.
--
-- Verified against a live database before writing this: inserting a
-- ROLLING_WINDOW row and a CUMULATIVE_30D row that differ ONLY in
-- measurementWindow raised
--     duplicate key value violates unique constraint
--       "metric_snapshots_entityId_entityLevel_date_granularity_sour_key"
-- and only one row persisted.
--
-- SAFETY: widening a unique key is monotonic — it can only ADMIT rows that were
-- previously rejected, never invalidate rows that already exist. Whatever this
-- table currently holds was unique under the narrower key and is therefore
-- unique under the wider one, so the index build cannot fail on existing data.
--
-- No row is read, rewritten, deleted, or relabeled. No metric value, `date`,
-- or measurementWindow changes.
--
-- LOCK NOTE: this builds an index and briefly takes ACCESS EXCLUSIVE. Production
-- row count is UNKNOWN from here (the reachable DATABASE_URL is a local dev
-- database), so on a large table prefer running the CREATE UNIQUE INDEX
-- CONCURRENTLY form out-of-band and then pointing the constraint at it. Written
-- as the plain form because Prisma executes a migration as a single script and
-- CONCURRENTLY cannot run inside a transaction block.
--
-- Idempotent: safe to re-run.

-- 1. The new, wider unique index. Created BEFORE the old one is dropped so the
--    table is never momentarily unprotected.
CREATE UNIQUE INDEX IF NOT EXISTS "metric_snapshots_identity_key"
  ON "metric_snapshots" ("entityId", "entityLevel", "date", "granularity", "source", "measurementWindow");

-- 2. Retire the narrower key.
--
--    Prisma's `@@unique` emits a bare UNIQUE INDEX, not a table CONSTRAINT —
--    verified here: pg_constraint has no 'u' row for this table while pg_indexes
--    does. So DROP CONSTRAINT alone is a silent no-op that leaves the old key
--    enforcing, which is exactly how the first draft of this migration failed:
--    it reported success and the collision it was written to remove still fired.
--
--    Both forms are handled, because a database restored or hand-patched
--    elsewhere may legitimately have the constraint-backed variant, and an index
--    that BACKS a constraint cannot be dropped with DROP INDEX.
--
--    The name is Postgres's own truncation of the column list, so it is matched
--    rather than assumed.
DO $$
DECLARE
  target text;
BEGIN
  -- Constraint-backed variant first (DROP CONSTRAINT removes its index too).
  SELECT conname INTO target
  FROM pg_constraint
  WHERE conrelid = '"metric_snapshots"'::regclass
    AND contype = 'u'
    AND conname LIKE 'metric_snapshots_entityId_entityLevel_date_granularity_sour%'
  LIMIT 1;

  IF target IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "metric_snapshots" DROP CONSTRAINT %I', target);
    RETURN;
  END IF;

  -- Plain unique index (what Prisma actually creates).
  SELECT indexname INTO target
  FROM pg_indexes
  WHERE tablename = 'metric_snapshots'
    AND indexname LIKE 'metric_snapshots_entityId_entityLevel_date_granularity_sour%'
  LIMIT 1;

  IF target IS NOT NULL THEN
    EXECUTE format('DROP INDEX %I', target);
  END IF;
END
$$;
