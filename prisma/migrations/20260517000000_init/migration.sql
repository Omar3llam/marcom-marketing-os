-- ============================================================
-- MARCOM Production Baseline Migration
-- ============================================================
-- This is the baseline migration representing the current
-- production schema state. All tables already exist in
-- production, so this migration uses IF NOT EXISTS.
-- ============================================================

-- Already handled by ensureSchema() in models - this migration
-- documents the expected state but doesn't execute CREATE statements
-- for tables that already exist.

-- For initial deployment: run `prisma migrate resolve --applied 20260517000000_init`
-- to mark this migration as already applied without executing SQL.

-- Future migrations will be applied automatically via `prisma migrate deploy`.
