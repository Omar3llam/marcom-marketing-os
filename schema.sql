-- ============================================================
-- MARCOM — PostgreSQL Session Schema
-- Run once: psql $DATABASE_URL -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS marcom_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT        NOT NULL UNIQUE,
  user_id          TEXT        NOT NULL,           -- Clerk userId; enforces ownership
  current_mode     SMALLINT    NOT NULL DEFAULT 1,
  current_section  SMALLINT    NOT NULL DEFAULT 0,
  current_service  SMALLINT    NOT NULL DEFAULT 0,
  context_locked   BOOLEAN     NOT NULL DEFAULT false,
  context_summary  TEXT        NOT NULL DEFAULT '',
  conversation_history  JSONB  NOT NULL DEFAULT '[]',
  service_history       JSONB  NOT NULL DEFAULT '[]',
  content_interrogation_log TEXT NOT NULL DEFAULT '',
  campaign_analysis_log     TEXT NOT NULL DEFAULT '',
  hybrid_raw_data           TEXT NOT NULL DEFAULT '',
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','locked','error')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON marcom_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON marcom_sessions (user_id);

-- Auto-update last_updated on every row change
CREATE OR REPLACE FUNCTION touch_last_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_updated = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_last_updated ON marcom_sessions;
CREATE TRIGGER trg_touch_last_updated
  BEFORE UPDATE ON marcom_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_last_updated();
