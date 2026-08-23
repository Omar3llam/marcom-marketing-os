-- SC-2 — Action schema closure.
-- Production measured at 0 rows before this migration: no backfill, no archival.
--
-- The FK is dropped first because it is what makes the table undroppable, not
-- because audit_logs is changing: `audit_logs.actionId` keeps its column and
-- its data. Postgres refuses DROP TABLE while a constraint depends on it.

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actionId_fkey";
DROP TABLE IF EXISTS "actions";
DROP TYPE IF EXISTS "ActionStatus";
