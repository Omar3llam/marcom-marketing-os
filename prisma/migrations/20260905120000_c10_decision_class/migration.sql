-- ============================================================
-- C-10 · Decision class is part of decision identity
-- ============================================================
-- Adds `decisions.decisionClass` and back-fills it from the string prefixes
-- five writers have been encoding it in.
--
-- ── WHY THE CONNECTOR LIST IS SPELLED OUT BELOW ─────────────────────────────
-- A backfill is a POINT-IN-TIME classification of rows that already exist, so
-- it names the eleven causes the engine could emit on 2026-09-05 rather than
-- deferring to a set that will keep changing. `decisionClassifier.js` reads the
-- live `CONNECTOR_ROOT_CAUSES`, and `decisionClassMigration.test.js` compares
-- the two — a duplicated rule is allowed to exist only when something proves
-- the copies agree.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- It does not invent a class for a row it cannot place. A `rootCause` naming an
-- enum value since deleted stays NULL, which means UNCLASSIFIED. The residue is
-- REPORTED, not failed on: it is a fact about the data, and a migration that
-- refused to finish over it would be claiming the data owes it something.
--
-- There is no DEFAULT and no NOT NULL, permanently. A default would let a
-- future writer claim a class it never declared, which is the exact contract
-- this slice adds on the write side.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- `decisions` is read `select`-less in several places, so a client that knows
-- this column before the database has it will crash on those reads (#209 →
-- #210). This migration reaches an environment BEFORE the code that names the
-- column. Same constraint C-05 and C-18 documented; unchanged.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DecisionClass') THEN
    CREATE TYPE "DecisionClass" AS ENUM ('SIGNAL', 'GUARDRAIL', 'ALLOCATION', 'EXPERIMENT');
  END IF;
END $$;

ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "decisionClass" "DecisionClass";

-- ── Backfill ────────────────────────────────────────────────────────────────
-- One statement per encoding, each conditional on `rootCause`. Every UPDATE
-- carries `"decisionClass" IS NULL` so the migration is re-runnable and so no
-- statement can overwrite a classification an earlier one made.

-- GuardrailSweepService — `guardrail:<rule.name>`
UPDATE "decisions" SET "decisionClass" = 'GUARDRAIL'
 WHERE "decisionClass" IS NULL AND "rootCause" LIKE 'guardrail:%';

-- AllocationService — `allocation:<planId>`
UPDATE "decisions" SET "decisionClass" = 'ALLOCATION'
 WHERE "decisionClass" IS NULL AND "rootCause" LIKE 'allocation:%';

-- TestTrackerService (`test:<testId>`) and IncrementalityService
-- (`incrementality:<testId>`) are ONE class: two producers, two subtypes, one
-- population semantics. `rootCause` keeps the difference.
UPDATE "decisions" SET "decisionClass" = 'EXPERIMENT'
 WHERE "decisionClass" IS NULL
   AND ("rootCause" LIKE 'test:%' OR "rootCause" LIKE 'incrementality:%');

-- VerdictService — a bare diagnosis cause, or NULL.
--
-- NULL IS A SIGNAL, NOT AN UNKNOWN: the engine leaves the cause null on
-- verdicts it reached without a diagnosis, the early gates especially. Treating
-- it as unclassifiable would strand exactly the campaigns that never got one.
UPDATE "decisions" SET "decisionClass" = 'SIGNAL'
 WHERE "decisionClass" IS NULL AND "rootCause" IS NULL;

UPDATE "decisions" SET "decisionClass" = 'SIGNAL'
 WHERE "decisionClass" IS NULL
   AND "rootCause" IN (
     'LOW_CTR', 'CREATIVE_FATIGUE', 'AUDIENCE_MISMATCH', 'INEFFICIENT_SCALING',
     'HEALTHY', 'UNDIAGNOSABLE', 'INSUFFICIENT_DATA', 'TOO_EARLY',
     'FUNNEL_DROP_POST_CLICK', 'FUNNEL_DROP_POST_LPV', 'FUNNEL_DROP_CHECKOUT'
   );

CREATE INDEX IF NOT EXISTS "decisions_workspaceId_decisionClass_idx"
    ON "decisions" ("workspaceId", "decisionClass");

-- ── Post-condition ──────────────────────────────────────────────────────────
-- Reaching the first assertion is itself the first assertion: a migration that
-- silently half-applied would fail here rather than report success.
DO $$
DECLARE
  col_count  INT;
  idx_count  INT;
  unresolved INT;
BEGIN
  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_name = 'decisions' AND column_name = 'decisionClass';
  SELECT COUNT(*) INTO idx_count FROM pg_indexes
   WHERE tablename = 'decisions' AND indexname = 'decisions_workspaceId_decisionClass_idx';
  SELECT COUNT(*) INTO unresolved FROM "decisions" WHERE "decisionClass" IS NULL;

  IF col_count <> 1 THEN
    RAISE EXCEPTION 'C-10: expected decisions.decisionClass, found % matching columns', col_count;
  END IF;
  IF idx_count <> 1 THEN
    RAISE EXCEPTION 'C-10: expected decisions_workspaceId_decisionClass_idx, found %', idx_count;
  END IF;

  -- NOT an exception. An unclassifiable row is an honest outcome, and the count
  -- is the thing worth knowing — it is how many rows no scoped reader will see
  -- from now on, which is a fact somebody should meet here rather than on a
  -- surface three weeks later.
  RAISE NOTICE 'C-10: % decision row(s) could not be classified and remain NULL', unresolved;
END $$;
