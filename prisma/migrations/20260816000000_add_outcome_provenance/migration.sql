-- ============================================================
-- R6 — Outcome Provenance + Historical Integrity (I19)
-- ============================================================
-- A recorded outcome must be able to name what it measured, and must not change
-- after the fact.
--
-- R5 gave a Decision the ability to say which population, which window, which
-- source and when the evidence was observed. Its OUTCOME — the record that
-- judges whether the decision was right — could say `roasDelta: 1.8` and nothing
-- else: not what was measured, not from where, not when, not against what. And
-- the writer UPDATED the row in place, so a recorded result could be rewritten
-- with no version, no audit and nothing on the row to say it had happened.
--
-- FOUR ADDITIVE, NULLABLE COLUMNS
-- -------------------------------
--   measuredAt         when the operator ESTABLISHED the result. Distinct from
--                      createdAt (when the row was written) on purpose: they are
--                      different facts and collapsing them would let the record
--                      date itself to whenever someone got round to typing it.
--   evidenceReference  the evidence Lumi holds for that entity over the measured
--                      period, in the R5 shape. A DIFFERENT question from
--                      Decision.evidenceReference — measured-against, not
--                      decided-from — which is why it is its own column on its
--                      own table and never a copy of the decision's.
--   supersededAt       the row is no longer the current outcome.
--   supersededById     the row that replaced it.
--
-- NULLABLE, AND NO BACKFILL. Every row written before R6 is a legacy
-- human-entered outcome with no measurement provenance and no measuredAt. That
-- is a fact about those rows, and inventing a population, a source, an
-- observation time or a measurement instant for them would make each one assert
-- something nobody recorded. NULL here means "not captured", and the readers
-- must keep it distinguishable from "captured as empty".
--
-- ONE INDEX. `(decisionId, supersededAt)` serves the current-outcome read —
-- the one query the supersession chain adds to every accuracy pass.
--
-- NO FOREIGN KEY on supersededById. It points inside this table, and the
-- decision's ON DELETE CASCADE already removes the whole chain together; adding
-- a self-referencing constraint would buy nothing and complicate that delete.
--
-- Additive and idempotent. Hand-authored: `prisma migrate dev` is never run
-- against the real database.
-- ============================================================

ALTER TABLE "outcome_snapshots"
  ADD COLUMN IF NOT EXISTS "measuredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "evidenceReference" JSONB,
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supersededById" UUID;

CREATE INDEX IF NOT EXISTS "outcome_snapshots_decisionId_supersededAt_idx"
  ON "outcome_snapshots"("decisionId", "supersededAt");
