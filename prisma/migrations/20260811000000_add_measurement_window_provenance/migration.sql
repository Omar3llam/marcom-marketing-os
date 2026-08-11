-- MetricSnapshot.measurementWindow — what period a row's metrics actually cover.
--
-- `granularity` could never answer this: every writer hardcodes DAILY, including
-- on rows holding 90 days or Meta's full ~37-month retention. `date` cannot
-- answer it either — it is the SYNC timestamp, not a measurement date.
--
-- HISTORICAL ROWS ARE NOT GUESSED. Every existing row becomes LEGACY_UNKNOWN,
-- which is the true statement: the request preset was never persisted, so their
-- period is unrecoverable. They are NOT inferred to be 90d from the cron
-- cadence, and NOT read as daily from granularity = 'DAILY'.
--
-- SAFE ON A LARGE TABLE. On PostgreSQL 11+ `ADD COLUMN ... NOT NULL DEFAULT
-- <constant>` records the default in the catalog instead of rewriting every row,
-- so this is O(1) regardless of table size and takes only a brief ACCESS
-- EXCLUSIVE lock. The default is then DROPped so the application can never
-- inherit a window it did not establish — new writes must state one.
--
-- No row is deleted. No metric value, `date`, or natural-key column is touched.
-- Idempotent (IF NOT EXISTS / guarded DO blocks) so it is safe to re-run.

-- 1. The enum. Guarded rather than IF NOT EXISTS: CREATE TYPE has no such form.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MeasurementWindow') THEN
    CREATE TYPE "MeasurementWindow" AS ENUM (
      'LEGACY_UNKNOWN',
      'ROLLING_WINDOW',
      'DAILY',
      'CUMULATIVE_30D'
    );
  END IF;
END
$$;

-- 2. The column. NOT NULL with a constant default → no table rewrite; every
--    pre-existing row reads LEGACY_UNKNOWN.
ALTER TABLE "metric_snapshots"
  ADD COLUMN IF NOT EXISTS "measurementWindow" "MeasurementWindow"
  NOT NULL DEFAULT 'LEGACY_UNKNOWN';

-- 3. Drop the default so nothing silently inherits it. From here a row's window
--    is stated by its producer or the write fails.
ALTER TABLE "metric_snapshots"
  ALTER COLUMN "measurementWindow" DROP DEFAULT;

-- 4. The period the producer reported, when it reported one. Meta returns
--    date_start/date_stop on every insights row (already in
--    CAMPAIGN_INSIGHT_FIELDS; dropped at normalize until now). Nullable: pre-
--    Phase-C rows and sources that report no period stay NULL — never a
--    fabricated range.
ALTER TABLE "metric_snapshots" ADD COLUMN IF NOT EXISTS "windowStart" TIMESTAMP(3);
ALTER TABLE "metric_snapshots" ADD COLUMN IF NOT EXISTS "windowEnd"   TIMESTAMP(3);
