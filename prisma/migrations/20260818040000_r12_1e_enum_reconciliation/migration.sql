-- R12-1e — make the migration history produce the schema production already runs
--
-- THE DEFECT
--
-- schema.prisma declares seven enums. The original init migration created their
-- columns as TEXT and no migration ever created the types. Production acquired
-- both out-of-band (the `db push` documented in 20260818030000), so:
--
--   production            : seven enum types, seven enum-backed columns
--   fresh migration-built : no enum types, seven TEXT columns
--
-- That is not a cosmetic gap. The generated Prisma client casts enum parameters
-- ($1::"CampaignStage"), so on a migration-built database — which is what CI and
-- every fresh developer database are — writes to those seven tables fail with
-- 42704 "type does not exist". CI and production have not been running the same
-- physical schema.
--
-- WHY PRISMA'S OWN SQL WAS REJECTED
--
-- `migrate diff` compares migration history to schema, never to production, and
-- proposes:
--
--   CREATE TYPE "CampaignStage" AS ENUM (...);
--   ALTER TABLE "campaign_states" DROP COLUMN "stage",
--   ADD COLUMN     "stage" "CampaignStage" NOT NULL;
--
-- Against production that is destructive (DROP COLUMN on live columns) and it
-- fails outright on the first unguarded CREATE TYPE with 42710. This migration
-- is therefore hand-authored: it reconciles history UP TO production and is a
-- no-op wherever production's shape already exists.
--
-- WHAT IT REFUSES TO DO
--
-- It never drops a column, never drops or alters an existing type, never adds a
-- label, and never coerces a value. Where reality disagrees with the canonical
-- contract it raises and stops the deploy, because a migration that silently
-- accepts a divergent enum would hide exactly the class of drift that produced
-- this situation.

-- ── Part 1 — the seven types ──────────────────────────────────────────────
-- Guarded creation, then exact-label validation. PostgreSQL has no
-- CREATE TYPE IF NOT EXISTS; faking one with an unguarded CREATE TYPE is what
-- would break the Render deploy, and a bare "already exists, carry on" guard is
-- not enough either — it would accept a type whose labels differ and leave a
-- permanent invisible mismatch. Existence and correctness are checked
-- separately.
DO $$
DECLARE
  rec       record;
  type_kind char;
  actual    text[];
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('UserRole',        ARRAY['ADMIN','VIEWER']),
      ('ActionStatus',    ARRAY['PENDING','QUEUED','EXECUTED_SUCCESS','FAILED','ROLLED_BACK']),
      ('ExecutionStatus', ARRAY['SUCCESS','FAILED','PENDING','PAUSED_FOR_APPROVAL','RESUMING','RESUMED']),
      ('ActionType',      ARRAY['PAUSE_CAMPAIGN','RESUME_CAMPAIGN','INCREASE_BUDGET','DECREASE_BUDGET',
                                'PAUSE_ADSET','RESUME_ADSET','SCALE_CAMPAIGN','OPTIMIZE_CAMPAIGN',
                                'REALLOCATE_BUDGET','REFRESH_CREATIVE']),
      ('CampaignStage',   ARRAY['TESTING','SCALING','STABLE','FATIGUED','DYING']),
      ('WebhookProvider', ARRAY['META','GOOGLE']),
      ('WebhookStatus',   ARRAY['RECEIVED','PROCESSED','DUPLICATE','FAILED'])
    ) AS t(type_name, labels)
  LOOP
    SELECT ty.typtype INTO type_kind
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'public' AND ty.typname = rec.type_name;

    IF type_kind IS NULL THEN
      EXECUTE format('CREATE TYPE %I AS ENUM (%s)', rec.type_name,
        (SELECT string_agg(quote_literal(l), ', ') FROM unnest(rec.labels) AS l));
      RAISE NOTICE 'R12-1e: created enum %', rec.type_name;

    ELSIF type_kind <> 'e' THEN
      RAISE EXCEPTION
        'R12-1e: type "%" exists but is not an enum (typtype=%). Refusing to touch it.',
        rec.type_name, type_kind;

    ELSE
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO actual
        FROM pg_type ty
        JOIN pg_namespace n ON n.oid = ty.typnamespace
        JOIN pg_enum e      ON e.enumtypid = ty.oid
       WHERE n.nspname = 'public' AND ty.typname = rec.type_name;

      IF actual IS DISTINCT FROM rec.labels THEN
        RAISE EXCEPTION
          'R12-1e: enum "%" has labels [%] but the canonical contract is [%]. Refusing to alter, drop or extend it.',
          rec.type_name, array_to_string(actual, ','), array_to_string(rec.labels, ',');
      END IF;
      RAISE NOTICE 'R12-1e: enum % already canonical', rec.type_name;
    END IF;
  END LOOP;
END $$;

-- ── Part 2 — the seven columns ────────────────────────────────────────────
-- For each column: skip if already the target enum (production), convert if
-- TEXT, and stop on anything else rather than guess at an unknown schema.
--
-- Every non-null value is proved to be a canonical label BEFORE the conversion
-- runs. A USING cast on an unexpected value would raise anyway, but it would
-- raise as an opaque cast error deep in the ALTER; the preflight names the table,
-- the column and the offending values instead.
--
-- Defaults are dropped and restored around the conversion because a TEXT default
-- ('PENDING'::text) blocks ALTER COLUMN TYPE. The restored default is the same
-- literal, now enum-typed — identical to what production already carries.
-- Nullability, indexes, constraints and data are otherwise untouched; ALTER TYPE
-- rebuilds dependent indexes itself.
DO $$
DECLARE
  rec      record;
  cur_type text;
  labels   text[];
  bad_vals text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('actions',         'status',     'ActionStatus',    'PENDING'::text),
      ('audit_logs',      'actionType', 'ActionType',      NULL::text),
      ('audit_logs',      'status',     'ExecutionStatus', 'PENDING'::text),
      ('campaign_states', 'stage',      'CampaignStage',   NULL::text),
      ('users',           'role',       'UserRole',        'VIEWER'::text),
      ('webhook_events',  'provider',   'WebhookProvider', NULL::text),
      ('webhook_events',  'status',     'WebhookStatus',   'RECEIVED'::text)
    ) AS t(tbl, col, enum_name, default_value)
  LOOP
    SELECT c.udt_name INTO cur_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = rec.tbl AND c.column_name = rec.col;

    IF cur_type IS NULL THEN
      RAISE EXCEPTION 'R12-1e: column %.% does not exist', rec.tbl, rec.col;

    ELSIF cur_type = rec.enum_name THEN
      -- Production, and any database already reconciled. Nothing to do.
      RAISE NOTICE 'R12-1e: %.% already %', rec.tbl, rec.col, rec.enum_name;
      CONTINUE;

    ELSIF cur_type <> 'text' THEN
      RAISE EXCEPTION
        'R12-1e: column %.% has unexpected type "%" (expected text or "%"). Refusing to convert an unknown schema.',
        rec.tbl, rec.col, cur_type, rec.enum_name;
    END IF;

    SELECT array_agg(e.enumlabel::text) INTO labels
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
      JOIN pg_enum e      ON e.enumtypid = ty.oid
     WHERE n.nspname = 'public' AND ty.typname = rec.enum_name;

    EXECUTE format(
      'SELECT string_agg(DISTINCT %I::text, '', '') FROM %I WHERE %I IS NOT NULL AND NOT (%I::text = ANY($1))',
      rec.col, rec.tbl, rec.col, rec.col)
      INTO bad_vals USING labels;

    IF bad_vals IS NOT NULL THEN
      RAISE EXCEPTION
        'R12-1e: %.% holds value(s) [%] outside the canonical % contract. Refusing to coerce or discard them.',
        rec.tbl, rec.col, bad_vals, rec.enum_name;
    END IF;

    IF rec.default_value IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', rec.tbl, rec.col);
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %I USING %I::text::%I',
      rec.tbl, rec.col, rec.enum_name, rec.col, rec.enum_name);

    IF rec.default_value IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %L::%I',
        rec.tbl, rec.col, rec.default_value, rec.enum_name);
    END IF;

    RAISE NOTICE 'R12-1e: converted %.% to %', rec.tbl, rec.col, rec.enum_name;
  END LOOP;
END $$;
