-- Decision lifecycle — from "a row that appeared" to "a decision a human engaged
-- with, and what happened next".
--
-- Today a Decision records only that the engine produced a verdict. Nothing
-- records that a human read the reasoning, that they went and acted on it, or
-- how the entity behaved afterwards. This adds those three moments and makes
-- `status` a real enum.
--
-- ── The enum carries FOUR values, not two ────────────────────────────────────
-- A narrower enum (PROPOSED | SUPERSEDED) would compile and pass every test,
-- then break the accuracy surface at RUNTIME: DecisionAccuracyService queries
-- `status: { in: ['EXECUTED','DISMISSED'] }` and `status: 'EXECUTED'`. Prisma
-- rejects an enum value that does not exist in the type, so both reads would
-- throw and the whole Proof surface would 500 — with no row of either status
-- needed to trigger it. The values are part of the read contract, not a
-- reflection of what production happens to hold.
--
-- ── Metrics AT the decision ──────────────────────────────────────────────────
-- `resolution` compares how an entity was performing when a verdict was issued
-- against how it performs when that verdict is replaced. The first half of that
-- comparison did not exist anywhere: Decision stores no metrics, and a
-- MetricSnapshot is a rolling per-sync aggregate re-stamped every sweep, so it
-- cannot be read backwards to "what did this look like in March".
--
-- So the engine now stamps ctr + roas onto the row it writes. Rows created
-- before this migration have neither, and resolve to UNKNOWN forever — which is
-- the honest answer, not a number reconstructed from data that no longer exists.
--
-- ctrAtDecision is a PERCENT (1.64 = 1.64%), matching verdictEngine's own
-- signalInput.ctr — NOT the 0..1 ratio a MetricSnapshot carries. The two units
-- live side by side in this codebase and conflating them silently turns every
-- threshold into a no-op.

-- ── Pre-flight: fail loudly, and name the offender ───────────────────────────
-- A cast to an enum fails on ANY unmapped value, with a message that names the
-- type rather than the data. This runs first so a surprise value stops the
-- migration with something an operator can act on.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO bad
  FROM "decisions"
  WHERE "status" NOT IN ('PROPOSED', 'EXECUTED', 'DISMISSED', 'SUPERSEDED');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'decisions.status holds unmapped value(s): %. Add them to DecisionStatus or normalise the rows before migrating.', bad;
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'EXECUTED', 'DISMISSED', 'SUPERSEDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DecisionResolution" AS ENUM ('IMPROVED', 'UNCHANGED', 'WORSENED', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Convert status ───────────────────────────────────────────────────────────
-- The default is dropped first: a DEFAULT 'PROPOSED' of type text cannot be
-- cast along with the column, and leaving it in place fails the ALTER.
ALTER TABLE "decisions" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "decisions"
  ALTER COLUMN "status" TYPE "DecisionStatus" USING "status"::"DecisionStatus";

ALTER TABLE "decisions"
  ALTER COLUMN "status" SET DEFAULT 'PROPOSED'::"DecisionStatus";

-- ── Lifecycle columns ────────────────────────────────────────────────────────
-- All nullable. Every one of them means "this has not happened / we were never
-- told", which must stay distinguishable from a measured zero.
ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "explainedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "intentAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolution"      "DecisionResolution",
  ADD COLUMN IF NOT EXISTS "confidenceDelta" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ctrAtDecision"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "roasAtDecision"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3);

-- Backfill updatedAt before the NOT NULL. A row that has never been updated was
-- last written when it was created — that is a fact, not a placeholder.
UPDATE "decisions" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "decisions" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "decisions" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ── Index for the learning query ─────────────────────────────────────────────
-- Partial: only resolved rows are ever read by getSimilarOutcomes, and they are
-- a small minority of the table.
CREATE INDEX IF NOT EXISTS "decisions_verdict_resolution_idx"
  ON "decisions"("verdict", "resolution")
  WHERE "resolution" IS NOT NULL;
