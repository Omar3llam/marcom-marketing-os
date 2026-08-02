-- Funnel Intelligence (PR #307)
--
-- Three additive, nullable columns. No backfill: rows written before this sync
-- genuinely have no funnel data, and manufacturing one from the metrics we DO
-- have (e.g. assuming lpv == clicks) is exactly the fabrication the governing
-- rule forbids. They stay NULL and read as "unknown".
--
-- ── Why ONE Json column and not N integer columns ────────────────────────────
-- Meta's /insights returns `actions` / `action_values` as an OPEN-ENDED array of
-- {action_type, value}. landing_page_view, add_to_cart, initiate_checkout, lead,
-- and the video quartiles are all in the payload we already pay for — and the
-- list grows whenever Meta ships an event. A column per stage means a migration
-- per event; a JSONB bag means the normalizer's ACTION_MAP is the only thing
-- that changes. Nothing joins or aggregates on these in SQL (the funnel rules
-- are pure JS over one row), so the usual argument for real columns doesn't
-- apply here.
--
-- ── Why platformCreatedTime is on the ENTITY, not the snapshot ───────────────
-- It never changes, so one row should hold it rather than every daily snapshot.
-- More importantly, MetricSnapshot rows exist per (entity, date, SOURCE): a GA4
-- or manual actuals row carries no Meta creation time, so putting it there would
-- let an actuals overlay shadow it with NULL and silently disable the too-early
-- gate. `createdAt` on the same table is OUR row's write time — usually the first
-- sync, months after the campaign actually launched — and is not a substitute.

-- Full-funnel action bag: { purchase, lpv, atc, checkout, lead, …, purchaseValue }.
-- NULL (not '{}') when the platform reported no recognised action, so readers can
-- distinguish "no funnel data" from "a measured zero".
ALTER TABLE "metric_snapshots"
  ADD COLUMN IF NOT EXISTS "actionMetrics" JSONB;

-- Configured daily budget at sync time, minor units. On the SNAPSHOT because it
-- changes over time and the series is the point (a >20% step resets Meta's
-- learning phase). NULL for lifetime-budget campaigns and channels that don't
-- report one.
ALTER TABLE "metric_snapshots"
  ADD COLUMN IF NOT EXISTS "dailyBudgetMinor" INTEGER;

-- Platform-side creation time (Meta /campaigns `created_time`). The only honest
-- basis for days-running, which gates the too-early verdict rule.
ALTER TABLE "campaign_entities"
  ADD COLUMN IF NOT EXISTS "platformCreatedTime" TIMESTAMP(3);
