-- ============================================================
-- C1 — Decision Learning eligibility: engagement → intervention
-- ============================================================
-- The learning query behind "N of M similar decisions improved after action"
-- was gated on `intentAt`, which records that an operator COPIED the
-- recommendation or CLICKED through to the ad platform. Neither event observes
-- an ad account, so the sentence claimed an intervention the data never held.
--
-- The gate is now the canonical intervention union — the operator's own report
-- that they made the change, or Lumi's record that it made the change itself.
--
-- WHAT THIS MIGRATION DOES AND DOES NOT DO
--   It changes ONE partial index's predicate so the index still covers the
--   query that uses it. No column is added, dropped, renamed or rewritten. No
--   decision row is touched. `intentAt` keeps its column, its data and its
--   meaning — it is simply no longer read by this query.
--
-- WHY DROP-THEN-CREATE RATHER THAN A SECOND INDEX
--   A partial index's predicate cannot be altered in place. Creating a second
--   index and leaving the first would keep a stale object covering a population
--   nothing queries any more: dead weight on every write to `decisions`, and a
--   planner choice nobody intended. The replacement is deliberate, and it keeps
--   the NAME — `decisions_similarity_idx` is what `@@index(..., map: ...)`
--   pins, so a rename here would make the schema declaration stop matching the
--   deployed object and invite a duplicate on the next generate.
--
-- PRODUCTION DRIFT
--   Production is ahead of migration history (schema changes have been applied
--   with `db push`), so this index may or may not exist under this name there.
--   IF EXISTS / IF NOT EXISTS makes both cases converge on the same end state
--   instead of failing the deploy on the first one.
-- ============================================================

DROP INDEX IF EXISTS "decisions_similarity_idx";

CREATE INDEX IF NOT EXISTS "decisions_similarity_idx"
  ON "decisions"("workspaceId", "verdict", "rootCause", "channel")
  WHERE "resolution" IS NOT NULL
    AND ("humanExecutedAt" IS NOT NULL OR "platformExecutedAt" IS NOT NULL);
