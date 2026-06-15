-- Drop the Integration model (table "integrations").
--
-- Rationale: the table was write-dead — no code path ever created/updated a row.
-- Every Meta/Google credential read now resolves through credentialStore
-- (marcom_credentials), the OAuth-authoritative store. After PRs D/E/F the
-- model is read by zero services, so the table can be removed.
--
-- DROP TABLE removes the dependent indexes and constraints
-- (integrations_pkey, integrations_workspaceId_platform_key,
--  integrations_workspaceId_fkey, integrations_workspaceId_idx) automatically.
-- IF EXISTS keeps the migration idempotent across environments where the
-- table may already be absent (e.g. fresh dev DBs).

DROP TABLE IF EXISTS "integrations";
