-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Add comment for documentation
COMMENT ON COLUMN "workspaces"."currency" IS 'ISO 4217 currency code (EGP, USD, SAR, AED, EUR, GBP, etc.)';
