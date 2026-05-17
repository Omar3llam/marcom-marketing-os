// ============================================================
// MARCOM — UserContext model (PostgreSQL)
// One row per Clerk userId — stores the locked context snapshot
// produced by the onboarding wizard. Used as the source of truth
// when a fresh session is created on a new device or after the
// user clears localStorage.
//
// We do not introduce a second DB — Mongoose was the spec default,
// but the project already runs PostgreSQL and the "do not create a
// second DB connection" rule applies here too.
// ============================================================

import { getDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';

// ── Idempotent migration. Run once at server startup.
export async function ensureUserContextSchema() {
  const sql = getDb();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS marcom_user_context (
        user_id    TEXT        PRIMARY KEY,
        context    TEXT        NOT NULL DEFAULT '',
        saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    logger.info('[userContext] schema ensured ✓');
  } catch (err) {
    const code = err?.code || err?.sqlState;

    if (code === '42P07') {
      // 42P07 = duplicate_table (expected with IF NOT EXISTS)
      logger.debug({ code }, '[userContext] table already exists (expected)');
    } else {
      // Unexpected error
      logger.warn({ code, msg: err.message }, '[userContext] ensureSchema failed');
    }
  }
}

// ── Save / upsert ──────────────────────────────────────────
// One row per user — last write wins. Re-onboarding overwrites cleanly.
export async function saveUserContext(userId, context) {
  if (!userId)  throw new Error('saveUserContext: userId is required');
  if (typeof context !== 'string' || !context.trim()) {
    throw new Error('saveUserContext: context must be a non-empty string');
  }

  const sql = getDb();
  await sql`
    INSERT INTO marcom_user_context (user_id, context, saved_at)
    VALUES (${userId}, ${context}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      context  = EXCLUDED.context,
      saved_at = NOW()
  `;
  return { ok: true };
}

// ── Lookup ─────────────────────────────────────────────────
// Returns the stored context string, or null if no row exists.
export async function getUserContext(userId) {
  if (!userId) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT context FROM marcom_user_context
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const ctx = rows[0].context;
  return (typeof ctx === 'string' && ctx.trim()) ? ctx : null;
}
