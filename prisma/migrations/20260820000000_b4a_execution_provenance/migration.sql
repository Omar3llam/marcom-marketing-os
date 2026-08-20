-- ============================================================
-- R13-D / B4-A — split execution provenance into two facts
-- ============================================================
-- `decisions.executedAt` carried two different facts under one name:
--
--   * the operator self-reported acting themselves
--     (PATCH /api/lumi/decisions/:id/execute)
--   * the canonical worker landed a real Meta mutation
--     (decisionAttribution.stampDecisionExecuted, after EXECUTED_SUCCESS)
--
-- Nothing could tell them apart: no provenance column, and no consumer joined
-- to execution_requests to recover one. Accuracy, outcome maturity and the
-- pattern engine all read the column directly.
--
-- ADDITIVE AND REVERSIBLE. Two nullable columns are added and the old one is
-- KEPT. Nothing is dropped and no NOT NULL is introduced, so a rollback to the
-- previous deploy keeps working against this schema — which matters here
-- because this database is known to sit ahead of its migration history.
-- ============================================================

ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "humanExecutedAt"    TIMESTAMP(3);
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "platformExecutedAt" TIMESTAMP(3);

-- ── Backfill: every existing value is a HUMAN self-report ───────────────────
--
-- Load-bearing justification, not an assumption. The B3 discovery established
-- from production that `execution_requests` held ZERO rows (total = 0,
-- attributed = 0). `stampDecisionExecuted` is the only writer that could ever
-- have set this column from a platform mutation, and it runs only after an
-- ExecutionRequest reaches EXECUTED_SUCCESS. With no execution requests in
-- existence, no value in this column can have come from that path.
--
-- So every non-null `executedAt` was written by the self-report route, and
-- copying it to `humanExecutedAt` preserves the fact exactly rather than
-- reclassifying it. `platformExecutedAt` is deliberately left NULL for every
-- existing row: there is no evidence any platform mutation ever happened, and
-- inventing one would be precisely the false success this split exists to
-- prevent.
--
-- Idempotent: the WHERE keeps a re-run from overwriting a genuine post-migration
-- human stamp with the frozen legacy value.
UPDATE "decisions"
   SET "humanExecutedAt" = "executedAt"
 WHERE "executedAt" IS NOT NULL
   AND "humanExecutedAt" IS NULL;

-- Partial indexes for the two population reads. Named EXACTLY what Prisma
-- would generate for the matching @@index declarations, so the schema can
-- declare them without migrate diff proposing a redundant full-table duplicate
-- beside the smaller partial one (the R12-1c lesson, same pattern as
-- decisions_verdict_resolution_idx). IF NOT EXISTS keeps the partial form.
-- Original note: that replace the old
-- `executedAt IS NOT NULL` scans (accuracy population, pending-outcomes queue).
CREATE INDEX IF NOT EXISTS "decisions_workspaceId_humanExecutedAt_idx"
    ON "decisions" ("workspaceId", "humanExecutedAt")
 WHERE "humanExecutedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "decisions_workspaceId_platformExecutedAt_idx"
    ON "decisions" ("workspaceId", "platformExecutedAt")
 WHERE "platformExecutedAt" IS NOT NULL;
