-- SC-1 — CampaignState schema closure.
-- Production measured at 0 rows before this ran: no backfill, no archival.

DROP TABLE IF EXISTS "campaign_states";
DROP TYPE IF EXISTS "CampaignStage";
