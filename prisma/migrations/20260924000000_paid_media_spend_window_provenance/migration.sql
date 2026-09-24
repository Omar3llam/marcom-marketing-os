-- Additive proof fields. Existing bounds are date labels and historical rows
-- remain unknown; no timezone or interval is inferred during migration.
ALTER TABLE "metric_snapshots"
  ADD COLUMN "spendWindowStartUtc" TIMESTAMP(3),
  ADD COLUMN "spendWindowEndUtc" TIMESTAMP(3);
