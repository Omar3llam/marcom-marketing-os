-- R12-1d — give the LoopRun briefing column the name the code has always used
--
-- THE DEFECT
--
-- schema.prisma declares `aiInsight String?` with no @map, so the generated
-- client addresses a column named "aiInsight". Two migrations created the
-- physical column as "ai_insight" — 20260710000000 and 20260717000000 — and no
-- migration ever created "aiInsight". The two have never agreed.
--
-- It is an anomaly inside its own table. loop_runs was created by
-- 20260613000000 with all-camelCase quoted columns (workspaceId, startedAt,
-- proposalsByType, stageStatus, loopHealth, staleStages, createdAt). ai_insight
-- is the only snake_case column of the thirteen, and the migration that added
-- it is itself titled "Add aiInsight column". The spelling was a slip.
--
-- WHAT IT COST
--
-- Every read and write of the column failed with P2022 "column
-- loop_runs.aiInsight does not exist", on production AND on any database built
-- from this history — which is CI and every fresh developer database. Four call
-- sites were affected, each wrapped in a defensive catch added by PR #210, so
-- the failures were logged and swallowed rather than surfaced:
--
--   AgentHomeService (select aiInsight)        -> Overview AI Insight always null
--   copilot.js       (select aiInsight)        -> Copilot briefing always null
--   PortfolioAnalysisService (update aiInsight)-> the prose was never stored
--   AgenticLoopService runSweep (SELECT-LESS)  -> see below
--
-- The fourth is not a briefing read. It is runSweep's idempotency guard, and
-- being select-less it projected aiInsight too — so `last` was always null, the
-- reuse branch was never taken, and the scheduled worker re-ran a full sweep
-- (including an ANALYZE_PORTFOLIO gateway call) every time. Production audit:
-- 2950 loop_runs rows, ai_insight non-null = 0. Nothing was ever written.
--
-- WHY A RENAME AND NOT @map
--
-- Both reconcile the two names. The rename wins on one operational fact: the
-- DEPLOYED client already expects "aiInsight", so the moment this migration
-- applies the running code starts working — no code change, no client
-- regeneration, no redeploy. @map("ai_insight") would need all three, and would
-- enshrine the single snake_case column in an otherwise camelCase table.
--
-- WHY PRISMA'S OWN SQL WAS REJECTED
--
-- `migrate diff` proposes DROP COLUMN "ai_insight" + ADD COLUMN "aiInsight",
-- which destroys a live column to rebuild it empty. It is only harmless here
-- because the column happens to hold no data; on any database that did hold
-- some it would discard it silently. A rename preserves data by construction,
-- whatever the table contains, so that is what this does.
--
-- Production gate (read-only, re-run immediately before authoring): ai_insight
-- present, nullable, no default, not generated; aiInsight absent; non-null 0;
-- no index, constraint, trigger, view or pg_depend entry references the column.

DO $$
DECLARE
  has_old boolean;
  has_new boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.loop_runs'::regclass
       AND attname = 'ai_insight' AND NOT attisdropped
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.loop_runs'::regclass
       AND attname = 'aiInsight' AND NOT attisdropped
  ) INTO has_new;

  IF has_old AND has_new THEN
    -- Ambiguous by construction: two columns that both claim to be the
    -- briefing, and no rule here can know which one holds it. Merging or
    -- picking one is a decision about data, not about schema, so it stops.
    RAISE EXCEPTION
      'R12-1d: loop_runs has BOTH "ai_insight" and "aiInsight". Refusing to guess which holds the briefing — reconcile them by hand before deploying.';

  ELSIF has_old THEN
    -- The production and fresh-database case. A rename is a catalog-only
    -- operation: it moves no data, rewrites no rows, holds no long lock, and
    -- preserves whatever the column contains.
    ALTER TABLE "loop_runs" RENAME COLUMN "ai_insight" TO "aiInsight";
    RAISE NOTICE 'R12-1d: renamed loop_runs.ai_insight -> loop_runs."aiInsight"';

  ELSIF has_new THEN
    -- Already reconciled (a re-run, or a database restored from after this
    -- migration). Nothing to do — this is what makes it idempotent.
    RAISE NOTICE 'R12-1d: loop_runs."aiInsight" already present — no-op';

  ELSE
    -- Neither column exists. Not reachable through this repository's history
    -- (20260710000000 adds ai_insight unconditionally), but a database built
    -- some other way must still end in the canonical shape rather than silently
    -- lacking the column the client selects.
    ALTER TABLE "loop_runs" ADD COLUMN "aiInsight" TEXT;
    RAISE NOTICE 'R12-1d: added loop_runs."aiInsight"';
  END IF;
END $$;
