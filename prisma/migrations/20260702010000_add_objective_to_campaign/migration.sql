-- Campaign.objective — the platform campaign objective (Meta OUTCOME_LEADS,
-- OUTCOME_SALES, OUTCOME_AWARENESS, …) so the verdict engine can distinguish a
-- true awareness campaign from a conversion campaign with no measured revenue.
-- Nullable: pre-fix rows and non-Meta channels have none.
ALTER TABLE "campaign_entities" ADD COLUMN "objective" TEXT;
