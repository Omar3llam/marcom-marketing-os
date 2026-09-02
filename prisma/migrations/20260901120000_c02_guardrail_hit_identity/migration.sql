-- C-02 — a guardrail hit becomes an identifiable breach EPISODE.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- GuardrailSweepService writes each hit with
--     rootCause = 'guardrail:' || rule.name
-- and calls `createMany` with no existence check. A rule name is mutable and is
-- not unique, so that string identifies nothing: two sweeps over one unchanged
-- breach produce two indistinguishable rows, and a standing breach mints roughly
-- 96 a day against the 15-minute cron.
--
-- Deduplication was blocked on this, not the other way round — you cannot decide
-- which two rows to merge without first deciding what makes two breaches the
-- same breach. So does closure: R-3 recorded guardrail closure as "blocked on
-- missing identity", and it is the same blocker.
--
-- The identity a hit actually has is an EPISODE:
--     the pair (rule, entity), for as long as the breach is continuously seen.
-- It opens when a sweep that EVALUATED the pair finds a breach and none is open.
-- It closes when a sweep that EVALUATED the pair finds none. A later breach on
-- the same pair is a NEW episode, never a revival of the old one.
--
-- The stable half of that key was already in hand: `evaluateGuardrails` returns
-- `hit.ruleId`, a real uuid, which the writer discarded in favour of the display
-- name. This migration gives it a column.
--
-- ── WHY openHitKey RATHER THAN A PARTIAL INDEX ──────────────────────────────
--
-- The constraint we need is "at most one OPEN episode per (rule, entity)". The
-- obvious spelling is a partial unique index with a WHERE clause on status —
-- which Prisma cannot express, so it would be invisible to the schema and
-- reported as drift on every subsequent diff.
--
-- Instead the open-episode key is materialised in a nullable column and NULLed
-- on closure. PostgreSQL exempts NULL from unique constraints, so any number of
-- CLOSED episodes coexist while at most one may be OPEN. The constraint is a
-- plain `@@unique` the schema declares and Prisma understands, and closing an
-- episode is literally setting the column to NULL.
--
-- ── LEGACY ROWS ARE NOT MIGRATED, AND THAT IS THE POINT ─────────────────────
--
-- Existing guardrail rows keep `rootCause = 'guardrail:<name>'` and receive
-- `guardrailRuleId = NULL`, `openHitKey = NULL`. They are NOT back-filled.
--
-- Back-filling would mean resolving a mutable display name to a rule id as it
-- stands today. A renamed rule would capture hits it never fired, and two rules
-- sharing a name would be indistinguishable. That is inventing an identity for
-- rows that never had one, and it is exactly the failure mode R-6 was written
-- against — a pointer that looks auditable and is not.
--
-- The consequences are deliberate and all of them are silences:
--   · legacy rows never collide with new episodes (their key is NULL),
--   · they are never counted as an open episode, so a rule that fired before
--     this migration opens a fresh episode on its next breach,
--   · and they are never auto-closed, because closure requires the identity
--     they do not have.
-- What becomes of them — left, archived, bulk-dismissed — is a product decision
-- and deliberately not made here.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- Every step is additive and monotonic with respect to existing data:
--   · Two NULLable columns with no default. PostgreSQL 11+ adds these without
--     rewriting the table.
--   · One new enum value. Nothing is written with it by this script.
--   · The unique index is built over a column that is NULL in every existing
--     row, and NULLs do not collide — so the build cannot fail on data already
--     in the table, whatever it contains.
-- No row is read, rewritten, deleted, relabelled or re-keyed.
--
-- ENUM NOTE: `ALTER TYPE … ADD VALUE` inside a transaction requires PostgreSQL
-- 12 or later, and the new value may not be USED in the same transaction. It is
-- not used here. On an older server this statement fails and Prisma rolls the
-- whole migration back, which is the correct outcome rather than a half-applied
-- schema.
--
-- Idempotent: safe to re-run.

-- ── 1. The closure status ───────────────────────────────────────────────────
-- None of the existing four can say "the condition ended, and no human acted".
-- SUPERSEDED means a newer verdict replaced this one and belongs to
-- VerdictService's scope; EXECUTED and DISMISSED are human claims; PROPOSED
-- would leave every ended episode in every open query forever.
ALTER TYPE "DecisionStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

-- ── 2. The identity columns ─────────────────────────────────────────────────
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "guardrailRuleId" UUID;
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "openHitKey" TEXT;

-- ── 3. Deduplication, enforced by the database ──────────────────────────────
-- Not by a query. A query that intends uniqueness can be widened by a later edit
-- without anything failing; this cannot.
CREATE UNIQUE INDEX IF NOT EXISTS "decisions_workspaceId_openHitKey_key"
  ON "decisions" ("workspaceId", "openHitKey");

-- ── 4. "What has this rule caught" as a join, not a name match ──────────────
CREATE INDEX IF NOT EXISTS "decisions_workspaceId_guardrailRuleId_idx"
  ON "decisions" ("workspaceId", "guardrailRuleId");

-- ── 5. Post-condition — fail loudly rather than report a false success ──────
--
-- Steps 2-4 are all IF NOT EXISTS, which means every one of them is silent when
-- it matches nothing. The production schema is known to have drifted from the
-- migration history before, so "the statement applied to a table that already
-- looked different" is a real outcome and is indistinguishable from success
-- without this check.
--
-- A half-applied migration here would leave the sweep writing an identity the
-- database does not enforce: duplicates would resume silently while the deploy
-- log said the fix had shipped.
DO $$
DECLARE
  cols int;
  uniq int;
BEGIN
  SELECT count(*) INTO cols
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'decisions'
    AND column_name IN ('guardrailRuleId', 'openHitKey');

  IF cols <> 2 THEN
    RAISE EXCEPTION
      'C-02: expected both identity columns on "decisions", found %. '
      'The guardrail sweep would write an identity the schema cannot hold.', cols;
  END IF;

  -- Name-independent: is ANY unique index enforcing exactly (workspaceId, openHitKey)?
  SELECT count(*) INTO uniq
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'decisions'
    AND ix.indisunique AND NOT ix.indisprimary
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM pg_attribute a
          WHERE a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey))
        = ARRAY['openHitKey','workspaceId'];

  IF uniq < 1 THEN
    RAISE EXCEPTION
      'C-02: no unique index enforces (workspaceId, openHitKey). '
      'Duplicate open guardrail episodes would be accepted.';
  END IF;
END
$$;
