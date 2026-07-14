-- MetricSnapshot.reach — unique people who saw the ad (Meta /insights `reach`).
-- frequency = impressions ÷ reach, so this is the denominator Meta already
-- computes for us; it was fetched (CAMPAIGN_INSIGHT_FIELDS) but dropped at
-- normalize until now. Nullable: existing rows and non-reporting channels
-- (Google) have none — stays NULL, never backfilled with a fabricated 0.
-- Idempotent (IF NOT EXISTS) so it is safe to re-run on production.
ALTER TABLE "metric_snapshots" ADD COLUMN IF NOT EXISTS "reach" INTEGER;
