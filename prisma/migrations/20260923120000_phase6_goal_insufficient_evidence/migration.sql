-- Additive tracking state. Existing goal rows and monetary values are untouched.
ALTER TYPE "GoalStatus" ADD VALUE IF NOT EXISTS 'INSUFFICIENT_EVIDENCE';
ALTER TABLE "north_star_goals" ADD COLUMN IF NOT EXISTS "trackingUnavailableReason" TEXT;
