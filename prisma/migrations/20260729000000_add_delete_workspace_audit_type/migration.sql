-- DELETE_WORKSPACE — the admin panel can now delete REAL workspaces, not just
-- demos, so the audit log needs a type that says which one happened.
--
-- Additive and idempotent: one enum value, no table touched. DELETE_DEMO stays
-- exactly as it is — a demo teardown and a customer teardown are not the same
-- event, and collapsing them would make the log unable to answer "did anyone
-- ever delete a real account?", which is the only question it exists for.
--
-- ADD VALUE IF NOT EXISTS is non-transactional in older PostgreSQL, hence no
-- DO block: it is already a no-op on re-run.

-- AlterEnum
ALTER TYPE "AdminAuditType" ADD VALUE IF NOT EXISTS 'DELETE_WORKSPACE';
