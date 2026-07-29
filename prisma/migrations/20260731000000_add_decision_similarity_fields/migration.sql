-- Decision similarity — what makes two decisions comparable.
--
-- "9 of 12 similar decisions improved" is only worth saying if "similar" means
-- something. Verdict alone is too coarse: a KILL on a META conversion campaign
-- and a KILL on a Google awareness campaign have different track records, and
-- averaging them produces a number that describes neither.
--
-- rootCause and entityLevel were already stored. These two complete the key.
--
-- ── Why TEXT and not the Channel enum ────────────────────────────────────────
-- A Decision is a historical record. Pinning it to the live Channel enum means
-- a future enum change rewrites what past decisions claim about themselves, and
-- a channel we stop supporting can no longer be stored at all. rootCause is a
-- String? for the same reason. The value written is the Channel enum's own
-- string, so a join back to Campaign still lines up.
--
-- Both nullable and both backfill-free: rows written before this have no
-- channel or objective and must stay null. Guessing one from the entity's
-- CURRENT channel would assert something about the past that was never recorded.

ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "objective" TEXT,
  ADD COLUMN IF NOT EXISTS "channel"   TEXT;

-- The learning query filters on the whole key at once. The existing partial
-- index on (verdict, resolution) stays — it serves the coarse lookups; this one
-- covers the narrow ones without scanning.
CREATE INDEX IF NOT EXISTS "decisions_similarity_idx"
  ON "decisions"("workspaceId", "verdict", "rootCause", "channel")
  WHERE "resolution" IS NOT NULL AND "intentAt" IS NOT NULL;
