-- Human signals on a Decision: "I acted on this" and "I explicitly rejected it".
--
-- ── Why timestamps and not the status enum ───────────────────────────────────
-- DecisionStatus already carries EXECUTED and DISMISSED, and nothing in the
-- codebase writes either. The obvious move would be to start writing them. It is
-- the wrong one for this change, for two reasons:
--
--   1. Four readers gate on `status = 'PROPOSED'` (feed, agenticPlanner,
--      collaboration, and decisions.js' own stampOnce). Flipping the status
--      would silently remove a decision from three queues AND make /explain and
--      /intent 404 on it — a human who executes first and reads the reasoning
--      second would lose the explainedAt stamp entirely.
--   2. A status is one slot. A timestamp answers "when", which is the half the
--      accuracy engine actually needs: its outcome window currently starts at
--      issuance, so it measures however long the verdict sat unread as part of
--      the result.
--
-- So these are additive columns alongside explainedAt / intentAt, in the same
-- shape and with the same meaning: nullable, written once, never re-stamped.
-- Whether `status` should ALSO move is a separate decision with a separate blast
-- radius, and it is not made here.
--
-- ── Why not reuse intentAt ───────────────────────────────────────────────────
-- intentAt means "took it somewhere they could act" — copied the recommendation,
-- opened the ad platform. That is not proof of execution, and decisionLearning
-- already leans on it for exactly that weaker claim. Overloading it would
-- silently change what every existing row asserts about itself.
--
-- ── Mutual exclusion is enforced in the application, not here ────────────────
-- A CHECK constraint would be tighter, but the routes must return 409 with which
-- signal already landed, so they have to read the row first regardless. A
-- constraint would only convert that into an opaque 500 on a race, and the write
-- is a single UPDATE on one row by primary key.

ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "executedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);

-- Partial: the accuracy surface reads only the decisions a human acted on, and
-- they are a small minority of the table.
CREATE INDEX IF NOT EXISTS "decisions_workspace_executed_idx"
  ON "decisions"("workspaceId", "executedAt")
  WHERE "executedAt" IS NOT NULL;
