-- Backfill guard for migration-lag on production.
-- Every statement is idempotent (IF NOT EXISTS) and matches the DDL of the
-- migration that first introduced the column, so this is a safe no-op on any
-- DB that is already up to date, and self-heals a DB that fell behind.
--
-- Root cause it closes: loopRun.create's default projection RETURNS every
-- scalar column, so a missing loop_runs.ai_insight made the manual "Run sweep"
-- (POST /api/lumi/loop/run) throw and surface as "Request failed". The service
-- now uses an explicit select, but the column must still exist for the aiInsight
-- write in step 5 (PortfolioAnalysisService) to land.

-- loop_runs.ai_insight — introduced 20260710_add_ai_insight_to_loop_run.
-- Missing column breaks the sweep write (this bug).
ALTER TABLE "loop_runs"
  ADD COLUMN IF NOT EXISTS "ai_insight" TEXT;

-- metric_snapshots.reach — introduced 20260714_add_reach_to_metric_snapshot.
-- Nullable; existing rows / non-reporting channels stay NULL (never a fake 0).
ALTER TABLE "metric_snapshots"
  ADD COLUMN IF NOT EXISTS "reach" INTEGER;

-- workspaces.plan — introduced 20260715_add_plan_to_workspace.
-- Missing column breaks every requirePlan-gated route, not just the sweep.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'FREE';
