-- R13 — record what the HUMAN decided, beside what Lumi decided
--
-- Adds a third axis to Decision. `verdict` is what Lumi believed;
-- executedAt/dismissedAt are what happened on the ad platform; these four
-- columns are the operator's judgement of that belief. None overwrites another:
-- an OVERRIDE never rewrites `verdict`, because "Lumi said KILL" remains true
-- even when the buyer keeps the campaign. Two independent facts, not one
-- corrected one.
--
-- Purely additive. No column is dropped, renamed, retyped or backfilled, and
-- nothing existing changes meaning. Every new column is nullable and stays that
-- way: NULL means no judgement was recorded, which must never be read as
-- CONFIRM or filled in with OTHER. The absence of an opinion is not an opinion.
--
-- Enum creation follows the standard R12-1e set: guarded creation, and then a
-- SEPARATE exact-label check. A bare "already exists, carry on" guard would
-- silently accept a type whose labels differ and leave a permanent invisible
-- mismatch — which is the class of drift that produced R12-1c/1d/1e. Existence
-- and correctness are different questions and are asked separately.
--
-- Safe against a database that already has any part of this (re-run, restore,
-- or a branch deployed twice): every step is conditional, so the migration is a
-- no-op on an already-reconciled schema. No DROP TYPE, no destructive SQL.

-- ── The two enums ─────────────────────────────────────────────────────────
DO $$
DECLARE
  rec       record;
  type_kind char;
  actual    text[];
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('HumanDecisionResponse', ARRAY['CONFIRM','OVERRIDE','ADJUST']),
      ('HumanDecisionReason',   ARRAY['OBJECTIVE_CONTEXT','BUSINESS_CONSTRAINT','TOF_ROLE',
                                      'BRAND_ROLE','SEASONALITY','DATA_CONTEXT','TESTING_INTENT',
                                      'RISK_TOLERANCE','OTHER'])
    ) AS t(type_name, labels)
  LOOP
    SELECT ty.typtype INTO type_kind
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'public' AND ty.typname = rec.type_name;

    IF type_kind IS NULL THEN
      EXECUTE format('CREATE TYPE %I AS ENUM (%s)', rec.type_name,
        (SELECT string_agg(quote_literal(l), ', ') FROM unnest(rec.labels) AS l));
      RAISE NOTICE 'R13: created enum %', rec.type_name;

    ELSIF type_kind <> 'e' THEN
      RAISE EXCEPTION
        'R13: type "%" exists but is not an enum (typtype=%). Refusing to touch it.',
        rec.type_name, type_kind;

    ELSE
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO actual
        FROM pg_type ty
        JOIN pg_namespace n ON n.oid = ty.typnamespace
        JOIN pg_enum e      ON e.enumtypid = ty.oid
       WHERE n.nspname = 'public' AND ty.typname = rec.type_name;

      IF actual IS DISTINCT FROM rec.labels THEN
        RAISE EXCEPTION
          'R13: enum "%" has labels [%] but the canonical contract is [%]. Refusing to alter, drop or extend it.',
          rec.type_name, array_to_string(actual, ','), array_to_string(rec.labels, ',');
      END IF;
      RAISE NOTICE 'R13: enum % already canonical', rec.type_name;
    END IF;
  END LOOP;
END $$;

-- ── The four columns ──────────────────────────────────────────────────────
-- IF NOT EXISTS on each, so a partially-applied state completes rather than
-- failing. Nullable with no default, by design.
ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "humanResponse"    "HumanDecisionResponse",
  ADD COLUMN IF NOT EXISTS "humanReasonCode"  "HumanDecisionReason",
  ADD COLUMN IF NOT EXISTS "humanReasonNote"  TEXT,
  ADD COLUMN IF NOT EXISTS "humanRespondedAt" TIMESTAMP(3);

-- No index. The judgement columns are read alongside a decision that has
-- already been selected by the existing keys (workspaceId + verdict + rootCause
-- + channel for the learning read, id + workspaceId for the write), so an index
-- here would serve no query that exists. R14 can add one when it has a read
-- that needs it — an unused index is a cost with no reader.
