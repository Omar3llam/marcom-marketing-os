-- C-05 — promoting a learned pattern becomes an AUTHORIZATION, and stays revocable.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- `promotePattern` created a GuardrailRule in one call and recorded the act in a
-- `logger.info`. Every other human act on a Decision is stamped in a column, and
-- this one — the act that hands Lumi durable authority to judge and raise on its
-- own account, forever, without being asked again — was the one that left no row
-- behind.
--
-- Three separate absences, one shape:
--   · no actor and no time. Nothing says who granted it, or when.
--   · no belief. `AccountPattern` is upserted IN PLACE, so `promotedRuleId` is a
--     pointer at a row that a later extraction rewrites. Following it answers
--     "what do we believe now", wearing the label of "what did we believe when
--     we granted this".
--   · no way back. `guardrailRule` had exactly two accesses in the entire
--     repository — one findMany and one create. Zero updates, zero deletes, no
--     route. The grant was permanent by omission, not by decision.
--
-- ── WHAT THIS MIGRATION ADDS, AND WHAT IT DELIBERATELY DOES NOT ─────────────
--
-- It adds the columns those three facts need. It does NOT add an audit table:
-- `collaboration_events` already has exactly the right shape (actor · type ·
-- subject · detail · createdAt, indexed by subjectId) and already carries the
-- approval half of this story for plans.
--
-- The frozen belief lives in that table's `detail` JSON, BY VALUE. That is the
-- point of the slice and it is why `sourcePatternId` below is documented as
-- identity: a second pointer would have reproduced the defect with a nicer name.
--
-- ── WHY THE NATURAL CLOSER ALSO CHANGES ─────────────────────────────────────
--
-- Revoking a rule closes the breach episodes it was holding open. C-02 gave an
-- episode an end; it did not give the end a REASON, because there was only one
-- way to end. Now there are two, and they share a shape:
--
--     RESOLVED · resolvedAt set · openHitKey NULL
--
-- A reader gets the row and nothing else. So `closureReason` is written by BOTH
-- closers — otherwise NULL would mean "the condition cleared, OR this row
-- predates the column", and the distinction would be born collapsed.
--
-- What neither closer writes is `resolution`. `decisionLearning` admits a row on
-- `resolution IS NOT NULL` together with an intervention stamp, so writing one
-- here would enrol every breach a revoked rule was holding into institutional
-- memory as a SUCCESS — teaching Lumi that switching a rule off improved the
-- account. Closing an episode says the asking stopped. It never says the account
-- got better.
--
-- ── LEGACY ROWS ARE NOT MIGRATED ────────────────────────────────────────────
--
-- Rules promoted before C-05 get `sourcePatternId = NULL` and are NOT back-filled
-- from `account_patterns.promotedRuleId`. That column would resolve, but it
-- points at a belief that has been rewritten in place an unknown number of times
-- since, and stamping it here would manufacture a provenance claim the system
-- never actually made. They are identifiable as pre-C-05 by the NULL, and nothing
-- further is asserted about them. Same ruling, same reason, as C-02's legacy hits.
--
-- Decisions closed before C-05 get `closureReason = NULL`. Never CONDITION_CLEARED:
-- we do not know which of them ended because a sweep judged them clear.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- Every step is additive and monotonic:
--   · Three NULLable columns, no defaults. PostgreSQL 11+ adds these without
--     rewriting the table.
--   · One new enum TYPE (created, not altered) and two new values on an
--     existing one. Neither is written by this script.
--   · One plain index on a column that is NULL in every existing row.
-- No row is read, rewritten, deleted, relabelled or re-keyed.
--
-- ENUM NOTE: `ALTER TYPE … ADD VALUE` inside a transaction requires PostgreSQL
-- 12+, and a value added there may not be USED in the same transaction. It is
-- not used here. On an older server the statement fails and Prisma rolls the
-- whole migration back — the correct outcome rather than a half-applied schema.
--
-- PROJECTION NOTE: `closureReason` lands on `decisions`, which is read by a great
-- many `select`-less queries. A new column silently widens every one of them, so
-- this migration must reach an environment BEFORE the code that names the column
-- does. That ordering has bitten this repository before.
--
-- Idempotent: safe to re-run.

-- ── 1. The grant and its withdrawal, as their own events ────────────────────
-- Not APPROVAL_DECIDED. An approval is a person answering a question; this is
-- the authority itself changing hands. Filing them together would make the one
-- moment that matters unfindable in the log that exists to record it.
ALTER TYPE "CollaborationEventType" ADD VALUE IF NOT EXISTS 'AUTONOMY_GRANTED';
ALTER TYPE "CollaborationEventType" ADD VALUE IF NOT EXISTS 'AUTONOMY_REVOKED';

-- ── 2. Why an episode ended ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'DecisionClosureReason' AND n.nspname = current_schema()) THEN
    CREATE TYPE "DecisionClosureReason" AS ENUM ('CONDITION_CLEARED', 'RULE_REVOKED');
  END IF;
END
$$;

ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "closureReason" "DecisionClosureReason";

-- ── 3. Provenance and revocation on the rule ────────────────────────────────
-- `sourcePatternId` is IDENTITY: which learning produced this rule. It says
-- nothing about what that learning claimed — the frozen claim is in the
-- AUTONOMY_GRANTED event, because the pattern row it would otherwise point at is
-- upserted in place.
--
-- `revokedAt` exists so that "revoked" is a recorded fact rather than an
-- inference from `enabled = false`, which anything else might also flip.
ALTER TABLE "guardrail_rules" ADD COLUMN IF NOT EXISTS "sourcePatternId" UUID;
ALTER TABLE "guardrail_rules" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "guardrail_rules_sourcePatternId_idx"
  ON "guardrail_rules" ("sourcePatternId");

-- ── 4. Post-condition — fail loudly rather than report a false success ──────
--
-- Every statement above is IF NOT EXISTS, so every one of them is silent when it
-- matches nothing. Production's schema is known to have drifted from the
-- migration history before, which makes "applied against a table that already
-- looked different" a real outcome and indistinguishable from success without
-- this check.
--
-- A half-applied migration here is worse than a failed one: revocation would
-- close episodes it could not label, and an administrative closure would become
-- indistinguishable from a breach that genuinely ended.
DO $$
DECLARE
  closure_col int;
  rule_cols   int;
  ev_values   int;
BEGIN
  SELECT count(*) INTO closure_col
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'decisions' AND column_name = 'closureReason';

  IF closure_col <> 1 THEN
    RAISE EXCEPTION
      'C-05: "decisions"."closureReason" is missing. A revoked rule would close '
      'episodes it cannot distinguish from a condition that genuinely cleared.';
  END IF;

  SELECT count(*) INTO rule_cols
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'guardrail_rules'
    AND column_name IN ('sourcePatternId', 'revokedAt');

  IF rule_cols <> 2 THEN
    RAISE EXCEPTION
      'C-05: expected both provenance columns on "guardrail_rules", found %. '
      'A grant would be unattributable or a revocation unrecordable.', rule_cols;
  END IF;

  SELECT count(*) INTO ev_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'CollaborationEventType'
    AND e.enumlabel IN ('AUTONOMY_GRANTED', 'AUTONOMY_REVOKED');

  IF ev_values <> 2 THEN
    RAISE EXCEPTION
      'C-05: CollaborationEventType is missing the autonomy events (found %). '
      'The moment autonomy changed hands would have nowhere to be recorded.', ev_values;
  END IF;
END
$$;
