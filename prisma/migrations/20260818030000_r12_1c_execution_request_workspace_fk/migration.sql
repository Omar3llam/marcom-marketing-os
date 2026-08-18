-- R12-1c — restore referential integrity to ExecutionRequest.workspaceId
--
-- WHY THIS EXISTS WHEN THE HISTORY ALREADY CREATES THE CONSTRAINT
--
-- 20260518000000_create_execution_requests and 20260518100000_create_execution_
-- requests_table both add "execution_requests_workspaceId_fkey" under IF NOT
-- EXISTS guards, and both recorded a clean apply in production
-- (applied_steps_count = 1, finished_at set, rolled_back_at null). Production
-- nonetheless has no such constraint, and nothing in the migration history ever
-- drops one.
--
-- The explanation consistent with every observation is that a `prisma db push`
-- ran against production between 2026-06-02 and 2026-07-29, reconciling the
-- database to prisma/schema.prisma — which at that time declared `workspaceId`
-- on this model with no `workspace` relation. Push obliged and removed the FK.
-- The same event explains the rest of the historical drift: seven enums created,
-- seven columns converted TEXT -> enum, and six FKs gaining ON UPDATE CASCADE,
-- none of which any migration performs.
--
-- So a fresh database built from the migration history already has this
-- constraint, while the one database that matters does not. `migrate diff`
-- cannot see that gap: it compares migration history to schema, and after the
-- accompanying schema change those two now agree. This migration is therefore
-- hand-written on purpose.
--
-- WHY IT MATTERS
--
-- R11 (I65) made uniqueness span (workspaceId, idempotencyKey), so workspaceId
-- now carries a tenant-isolation guarantee. Every sibling workspace-owned table
-- -- users, actions, audit_logs, campaign_states -- has had an FK behind that
-- column all along; this one has been the exception.
--
-- SAFETY
--
-- Additive only. No DROP, no column change, no type change, no index change.
-- Idempotent: the guard makes it a no-op wherever the constraint already exists,
-- which includes every fresh database built from this history.
--
-- Verified read-only against production before writing: execution_requests holds
-- 0 rows, 0 NULL workspaceId, 0 orphans, so validation cannot fail there.
--
-- The guard is deliberately NOT tolerant of orphan rows. If some environment did
-- hold a row pointing at a missing workspace, this must fail loudly rather than
-- skip -- an unenforceable tenant key is the defect being repaired, and silently
-- declining to repair it would reproduce the original fault.
--
-- Unlike the 2026-05 guards this one qualifies the lookup with conrelid, so a
-- same-named constraint on a different table cannot mask a genuinely missing one.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname  = 'execution_requests_workspaceId_fkey'
       AND conrelid = 'public.execution_requests'::regclass
       AND contype  = 'f'
  ) THEN
    ALTER TABLE "execution_requests"
      ADD CONSTRAINT "execution_requests_workspaceId_fkey"
      FOREIGN KEY ("workspaceId")
      REFERENCES "workspaces"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
