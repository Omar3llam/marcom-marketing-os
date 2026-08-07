-- ============================================================
-- Decision reasoning snapshot — hypotheses + counterfactuals
-- ============================================================
-- The verdict engine has always built both. projectHypotheses() produces the
-- candidate mechanisms with the readings each rests on; buildCounterfactuals()
-- records why every alternative was set aside. Both are attached to the node
-- that persistNode() writes, and both were dropped on the floor — they lived for
-- the duration of one HTTP response and were never stored.
--
-- The cost of that is not recoverable later. `rootCause` survives, but it is one
-- string: it says WHICH mechanism won, never what else was considered or what
-- argued against it. `counterfactuals[].preferredBecause` in particular — the
-- primary's evidence that the alternative would leave unexplained — cannot be
-- reconstructed from anything else on the row, because the MetricSnapshots it
-- was computed from are rolling aggregates re-stamped on every sync.
--
-- WHY JSONB AND NOT COLUMNS. This is STORAGE, not SEARCH. Nothing queries into
-- these today and nothing should: the shape is the engine's own reasoning
-- taxonomy, and normalising it into tables would freeze that taxonomy against a
-- schema that cannot follow it. If a learning query ever needs to filter on a
-- mechanism, it gets its own extracted, indexed column derived FROM this — the
-- snapshot stays the immutable record of what was believed.
--
-- NO BACKFILL. Historical rows keep NULL, and NULL here means "never captured",
-- which is true. It is deliberately distinct from `[]`, which means "the engine
-- ran and produced no hypotheses" — an early-gate decision under 1 000
-- impressions is a real state with a real empty list. Collapsing the two would
-- make a thin campaign indistinguishable from a row written before this PR.
--
-- Additive and idempotent. Hand-authored: `prisma migrate dev` is never run
-- against the real database.
-- ============================================================

ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "hypotheses"      JSONB,
  ADD COLUMN IF NOT EXISTS "counterfactuals" JSONB;
