-- AlterTable
ALTER TABLE "campaign_states" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Add comment for documentation
COMMENT ON COLUMN "campaign_states"."currency" IS 'ISO 4217 currency code (EGP, USD, SAR, AED, EUR, GBP, etc.)';
