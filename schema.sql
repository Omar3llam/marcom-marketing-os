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
  title            TEXT        NOT NULL DEFAULT '',  -- short label for sidebar (~40 chars)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-add title + project_id for existing deployments (idempotent)
ALTER TABLE marcom_sessions ADD COLUMN IF NOT EXISTS title      TEXT NOT NULL DEFAULT '';
ALTER TABLE marcom_sessions ADD COLUMN IF NOT EXISTS project_id TEXT          DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_session_id      ON marcom_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id         ON marcom_sessions (user_id);
-- Compound index for /api/history/list (user-scoped, sorted by recency)
CREATE INDEX IF NOT EXISTS idx_sessions_user_lastupdated
  ON marcom_sessions (user_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id
  ON marcom_sessions (project_id);

-- ============================================================
-- USER CONTEXT — onboarding wizard output, one row per Clerk user.
-- Used as the source of truth for /api/context/save + GET /api/context.
-- ============================================================
CREATE TABLE IF NOT EXISTS marcom_user_context (
  user_id    TEXT        PRIMARY KEY,
  context    TEXT        NOT NULL DEFAULT '',
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MARCOM PROJECTS — one row per project, scoped to a Clerk userId.
-- Replaces the single-global marcom_user_context for multi-project support.
-- ============================================================
CREATE TABLE IF NOT EXISTS marcom_projects (
  project_id   TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  name         TEXT        NOT NULL DEFAULT '',
  context      TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id      ON marcom_projects (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON marcom_projects (user_id, updated_at DESC);

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
