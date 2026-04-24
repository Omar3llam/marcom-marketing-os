#!/usr/bin/env node
// ============================================================
// MARCOM — Database Migration
// Applies schema.sql using the postgres npm client.
// Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
// Run automatically as part of Render build step.
// ============================================================
import 'dotenv/config';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL not set — skipping migration.');
  process.exit(0);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connect_timeout: 15,
});

async function migrate() {
  console.log('[migrate] Applying schema…');

  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

  await sql`
    CREATE TABLE IF NOT EXISTS marcom_sessions (
      id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id                 TEXT        NOT NULL UNIQUE,
      user_id                    TEXT        NOT NULL,
      current_mode               SMALLINT    NOT NULL DEFAULT 1,
      current_section            SMALLINT    NOT NULL DEFAULT 0,
      current_service            SMALLINT    NOT NULL DEFAULT 0,
      context_locked             BOOLEAN     NOT NULL DEFAULT false,
      context_summary            TEXT        NOT NULL DEFAULT '',
      conversation_history       JSONB       NOT NULL DEFAULT '[]',
      service_history            JSONB       NOT NULL DEFAULT '[]',
      content_interrogation_log  TEXT        NOT NULL DEFAULT '',
      campaign_analysis_log      TEXT        NOT NULL DEFAULT '',
      hybrid_raw_data            TEXT        NOT NULL DEFAULT '',
      status                     TEXT        NOT NULL DEFAULT 'active'
                                             CHECK (status IN ('active','locked','error')),
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_updated               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON marcom_sessions (session_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON marcom_sessions (user_id)
  `;

  await sql`
    CREATE OR REPLACE FUNCTION touch_last_updated()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.last_updated = NOW();
      RETURN NEW;
    END;
    $$
  `;

  // Drop + recreate trigger so OR REPLACE on the function takes effect
  await sql`DROP TRIGGER IF EXISTS trg_touch_last_updated ON marcom_sessions`;
  await sql`
    CREATE TRIGGER trg_touch_last_updated
      BEFORE UPDATE ON marcom_sessions
      FOR EACH ROW EXECUTE FUNCTION touch_last_updated()
  `;

  console.log('[migrate] Schema applied successfully.');
  await sql.end();
}

migrate().catch(err => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
