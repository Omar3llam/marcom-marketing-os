-- C-18 — a plan promotion becomes an act with a name and a time, and a plan
--        finally has a way to end.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- `PlanStatus.CLOSED` has ZERO writers in the entire system. Nothing reads
-- `periodEnd` to end a plan; no worker, no cron, no route. So a plan whose
-- period finished six months ago is still ACTIVE, and is still what
-- `/lumi/feed` and `AgenticLoopService` call "the active plan" —
-- indistinguishable from one genuinely in force. The client even carries a
-- style for CLOSED (`PlansPanel.jsx`), dressed for a state the backend cannot
-- produce.
--
-- And the promotion itself left nothing behind. No actor, no time. The
-- loop-health surface measures the PLAN stage by `plans.createdAt` — the moment
-- someone BUILT a plan — so a plan built today and never promoted reads FRESH,
-- and a plan promoted today after being built last quarter reads STALE. It was
-- watching the wrong event because the right one was not recorded.
--
-- ── WHY `promotedAt` IS NOT DECORATION ──────────────────────────────────────
--
-- It is the idempotency key, and it has to be. C-18 stops writing an
-- AllocationPlan row for a promotion whose approved mix asks for no budget
-- moves — a row published as "open, awaiting your confirm" that contains
-- nothing to confirm is a claim about work that does not exist. That leaves
-- `allocationPlanId` NULL on a plan that IS promoted, so guarding on it would
-- let the same plan be promoted a second time.
--
-- Both columns are still consulted: a plan promoted BEFORE this migration has
-- the id and no timestamp. Both mean promoted; one is the record, the other is
-- all that was left behind.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD ───────────────────────────
--
-- No outcome column, and no back-fill of one.
--
-- `GoalStatus.ACHIEVED` / `MISSED` and `AllocationStatus.ACCEPTED` / `REJECTED`
-- also have zero writers, and they stay that way here. The scheduled sweep this
-- migration enables writes `CLOSED` and `closedAt` and nothing else, because a
-- clock passing `periodEnd` can prove that a period ENDED and cannot prove that
-- a target was MET. Those need a producer that owns evidence.
--
-- This is Invariant 13 in a new place: C-05 established that an administrative
-- close must never write `resolution`, or every episode it closes enrols in
-- institutional memory as a success nobody claimed. Closure says the asking
-- stopped. It never says the account got better.
--
-- ── LEGACY ROWS ARE NOT MIGRATED ────────────────────────────────────────────
--
-- Plans promoted before C-18 get `promotedAt = NULL` and `promotedBy = NULL`.
-- They are NOT back-filled from `allocation_plans.createdAt`, which would
-- resolve for many of them: that timestamp is when an allocation was written,
-- and using it here would manufacture a promotion record the system never made
-- — and there is no candidate at all for WHO. They are identifiable as
-- pre-C-18 by the NULL, and nothing further is asserted about them.
--
-- Plans already past `periodEnd` are NOT closed by this script. The sweep will
-- close them on its next tick, stamping `closedAt` with the moment it actually
-- looked. Stamping it here would put a closure time on a plan at the instant of
-- a deploy, which is a fact about the deploy and not about the plan.
--
-- Same ruling, and the same reason, as C-02's legacy hits and C-05's legacy
-- rules: a migration must never pretend to know.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- Every step is additive and monotonic: three NULLable columns with no
-- defaults, which PostgreSQL 11+ adds without rewriting the table, plus one
-- plain index. No row is read, rewritten, deleted, relabelled or re-keyed. No
-- enum is created or altered — CLOSED already exists in `PlanStatus` and has
-- since Phase 6; it simply never had a writer.
--
-- PROJECTION NOTE: these columns land on `plans`, which is read `select`-less
-- in several places (PlanService.getPlan, AgenticLoopService, lumi/feed). A new
-- column silently widens every one of those reads, so this migration must reach
-- an environment BEFORE the code that names the columns does. That ordering has
-- bitten this repository before.
--
-- Idempotent: safe to re-run.

-- ── 1. The promotion, as an event rather than an inference ──────────────────
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMP(3);
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "promotedBy" UUID;

-- ── 2. The end of the lifecycle ─────────────────────────────────────────────
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

-- ── 3. The sweep's predicate ────────────────────────────────────────────────
-- The closure sweep runs GLOBALLY — one statement across all workspaces — so
-- the existing `plans_workspaceId_status_idx` cannot serve it.
--
-- Plain, not partial, even though a partial index on (status='ACTIVE' AND
-- closedAt IS NULL) would be smaller. Prisma cannot express a partial index in
-- `schema.prisma`, so this file and the schema would disagree permanently, and
-- this repository has already been bitten by production drifting from its
-- migration history. A silent divergence is a worse cost than a slightly larger
-- index on a table that holds tens of rows per workspace.
CREATE INDEX IF NOT EXISTS "plans_status_periodEnd_idx"
  ON "plans" ("status", "periodEnd");

-- ── 4. Post-condition — fail loudly rather than report a false success ──────
--
-- Every statement above is IF NOT EXISTS, so every one is silent when it
-- matches nothing. Production's schema is known to have drifted from the
-- migration history before, which makes "applied against a table that already
-- looked different" a real outcome and indistinguishable from success without
-- this check.
--
-- A half-applied migration here is the dangerous kind: without `promotedAt` the
-- promotion guard falls back to `allocationPlanId` alone, and a plan promoted
-- with no budget moves becomes promotable again — twice-executed governance,
-- reported as success.
DO $$
DECLARE
  plan_cols int;
  idx_count int;
BEGIN
  SELECT count(*) INTO plan_cols
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'plans'
    AND column_name IN ('promotedAt', 'promotedBy', 'closedAt');

  IF plan_cols <> 3 THEN
    RAISE EXCEPTION
      'C-18: expected all three lifecycle columns on "plans", found %. Without '
      'promotedAt a zero-move promotion can run twice; without closedAt an '
      'expired plan stays indistinguishable from one in force.', plan_cols;
  END IF;

  SELECT count(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = current_schema() AND indexname = 'plans_status_periodEnd_idx';

  IF idx_count <> 1 THEN
    RAISE EXCEPTION
      'C-18: "plans_status_periodEnd_idx" is missing — the closure sweep would scan '
      'every plan ever written on every tick.';
  END IF;
END
$$;
