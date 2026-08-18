-- R11 (F12 · RU-5) — cohort membership becomes server-assigned.
--
-- Every existing `cohortTag` is a free-text string its own workspace typed in
-- when it opted in. Those values are unverified claims about which population
-- an account belongs to, and the network read now derives the cohort from a
-- controlled attribute instead. Leaving the old strings in place would leave a
-- self-declared label sitting next to a server-derived fact, and the next
-- reader would have no way to tell which one was authoritative.
--
-- So the column is rewritten to what the server would assign today:
--   consenting workspaces  → the derived label for their controlled attribute
--   everyone else          → NULL (no participation, therefore no cohort)
--
-- Data-only: no schema change, so `prisma migrate diff` has nothing to
-- generate. Hand-written for the same reason as the R11-B collabRole backfill.
--
-- Note the derived label is NOT what selects peers — the read queries the
-- controlled attribute directly (see cohort.js · cohortWhere). This column is
-- a display label, and this statement makes it tell the truth.

UPDATE "workspaces"
   SET "cohortTag" = 'CUR-' || upper("currency")
 WHERE "networkConsent" = true
   AND "currency" ~ '^[A-Za-z]{3}$';

UPDATE "workspaces"
   SET "cohortTag" = NULL
 WHERE "cohortTag" IS NOT NULL
   AND ("networkConsent" = false OR "currency" !~ '^[A-Za-z]{3}$');
