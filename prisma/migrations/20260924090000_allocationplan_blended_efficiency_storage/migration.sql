-- Additive semantic storage. Existing merBefore/merAfter values remain untouched
-- and old application versions can ignore these nullable columns.
ALTER TABLE "allocation_plans"
  ADD COLUMN "blendedRevenueEfficiencyBefore" DOUBLE PRECISION,
  ADD COLUMN "blendedRevenueEfficiencyAfter" DOUBLE PRECISION;
