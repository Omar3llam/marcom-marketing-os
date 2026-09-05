-- ============================================================
-- C-16 · The memory that shaped a decision, frozen at commitment
-- ============================================================
-- R-6, Article VI. Adds three columns to `decisions` and the enum one of them
-- carries. PURELY ADDITIVE: no backfill, no default, no NOT NULL, no data
-- rewritten.
--
-- ── WHY THERE IS NO BACKFILL ────────────────────────────────────────────────
-- C-10 back-filled `decisionClass` because every row already ENCODED its class
-- in `rootCause` — the fact existed and only needed lifting. Nothing comparable
-- exists here. The write path never consulted memory, so no row carries a trace
-- of what memory said when it was written, and a backfill could only invent
-- one. R-6 forbids exactly that: a Decision naming no memory means memory was
-- not consulted, never that the account learned nothing.
--
-- The absence is therefore READ, not written: a NULL `memoryStatus` is
-- published by the server as NOT_CONSULTED. That keeps this migration free of
-- C-10's transitional hazard, where an instance running the old code writes
-- rows after the UPDATEs have run. There are no UPDATEs to race.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- `decisions` is read `select`-less in several places, so a client that knows
-- these columns before the database has them will crash on those reads
-- (#209 → #210). This migration reaches an environment BEFORE the code that
-- names the columns. Same constraint C-05, C-18 and C-10 documented; unchanged.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MemoryStatus') THEN
    CREATE TYPE "MemoryStatus" AS ENUM (
      'OK', 'NO_VALIDATED_MEMORY', 'MEMORY_UNAVAILABLE', 'NOT_CONSULTED'
    );
  END IF;
END $$;

-- The engine's own confidence, kept beside the published one. `confidence`
-- becomes what the operator was actually shown; this is what the evidence alone
-- said, so a reader who distrusts the history can recover the untouched number.
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "baseConfidence" DOUBLE PRECISION;

-- What we knew about this account's validated history when the call was made.
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "memoryStatus" "MemoryStatus";

-- The measurement itself: the factor, whether it moved anything, and every
-- relevant pattern's statement and numbers AS THEY STOOD. Values, never ids —
-- account_patterns is upserted in place and its `statement` is rewritten on
-- every sweep.
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "memoryProvenance" JSONB;

-- ── Post-condition ──────────────────────────────────────────────────────────
-- Reaching this block is itself the first assertion: a migration that silently
-- half-applied would fail here rather than report success.
DO $$
DECLARE
  cols INT;
  typ  INT;
BEGIN
  SELECT COUNT(*) INTO cols FROM information_schema.columns
   WHERE table_name = 'decisions'
     AND column_name IN ('baseConfidence', 'memoryStatus', 'memoryProvenance');
  SELECT COUNT(*) INTO typ FROM pg_type WHERE typname = 'MemoryStatus';

  IF cols <> 3 THEN
    RAISE EXCEPTION 'C-16: expected 3 memory columns on decisions, found %', cols;
  END IF;
  IF typ <> 1 THEN
    RAISE EXCEPTION 'C-16: expected the MemoryStatus type, found %', typ;
  END IF;
END $$;

-- ── decisions.confidence becomes nullable ───────────────────────────────────
-- The writer used to satisfy this column's NOT NULL with `?? 0.5` — an invented
-- coin flip, and the same fabrication I54 removed from the pattern engine, on
-- the one row R-6 exists to make auditable. Dropping NOT NULL is what lets that
-- default go: null now means "the engine measured no confidence for this call",
-- which is precisely what `baseConfidence` records beside it.
--
-- WIDENING, not a rewrite. Every existing row keeps its value, and a reader
-- that expects a number keeps receiving one: no production path can produce a
-- null (every finalise() in verdictEngine passes an explicit confidence, and
-- persistLevelVerdicts — the only other entry — has no production callers). It
-- changes what the column ACCEPTS, never what it holds.
--
-- Deliberately NOT reversible in the other direction without a data check: if a
-- null is ever written, restoring NOT NULL would need those rows resolved
-- first. That is the correct asymmetry — the constraint was hiding an invented
-- number, and re-imposing it should require somebody to look.
ALTER TABLE "decisions" ALTER COLUMN "confidence" DROP NOT NULL;

DO $$
DECLARE
  nullable TEXT;
BEGIN
  SELECT is_nullable INTO nullable FROM information_schema.columns
   WHERE table_name = 'decisions' AND column_name = 'confidence';
  IF nullable <> 'YES' THEN
    RAISE EXCEPTION 'C-16: decisions.confidence should be nullable, is_nullable = %', nullable;
  END IF;
END $$;
