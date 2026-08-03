-- Ad-level ingestion (PR #310) — creative age
--
-- One additive, nullable column. No backfill: ads that predate ad-level
-- ingestion have no recorded platform creation time, and deriving one from
-- `createdAt` (our own row's write time, which for these rows is the first sync
-- that ever saw them) would assert a creation date that was never observed.
--
-- At AD level this is CREATIVE AGE, which is the honest basis for a fatigue
-- trend: fatigue is about how long an audience has been seeing this specific
-- ad, not how long its campaign has existed. Mirrors
-- campaign_entities.platformCreatedTime (20260802000000).

ALTER TABLE "ads"
  ADD COLUMN IF NOT EXISTS "platformCreatedTime" TIMESTAMP(3);
