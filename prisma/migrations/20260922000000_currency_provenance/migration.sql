-- Add origin metadata only. No historical denomination or amount is inferred.
-- The uncertain default also supports old writers during a rolling deployment.
ALTER TABLE "metric_snapshots"
  ADD COLUMN "currencyProvenance" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
