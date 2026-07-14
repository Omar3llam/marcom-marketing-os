-- Feature-gating entitlement column. Non-null, defaults to FREE so every
-- existing row is a valid FREE workspace with no backfill needed.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'FREE';

-- One-time entitlement seed for the owner's workspace so it sees every surface.
-- Idempotent and environment-safe: matches exactly one row on the owner's DB and
-- no-ops everywhere else (fresh/other DBs simply update zero rows). The durable
-- way to change a plan is the admin panel (PATCH /api/admin/workspaces/:id/plan);
-- this is only the initial seed for the account that has no admin path yet.
UPDATE "workspaces"
  SET "plan" = 'PRO'
  WHERE "id" = 'c52262ec-fed1-4697-8f7a-982efea99fb0';
