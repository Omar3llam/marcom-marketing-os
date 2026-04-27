// ============================================================
// MARCOM — ChatSession model (PostgreSQL)
// Thin query wrapper over the existing `marcom_sessions` table.
// We do NOT introduce a second DB — Mongoose was the spec default,
// but the project already runs PostgreSQL via src/utils/db.js, so
// per the "do not create a second DB connection" rule we use it.
//
// Logical model (matches the spec contract):
//   { sessionId, userId, title, messages[], updatedAt }
//
// Backed by columns:
//   session_id, user_id, title, conversation_history (jsonb),
//   last_updated (TIMESTAMPTZ, auto-touched by trg_touch_last_updated)
// ============================================================

import { getDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';

const MAX_TITLE_LEN = 60;
const MAX_MESSAGES  = 200;

// ── Runtime migration — idempotent. Run once at server startup.
// Adds the `title` column and the (user_id, last_updated DESC) index
// for any deployment that pre-dates this feature.
export async function ensureChatSessionSchema() {
  const sql = getDb();
  try {
    await sql`ALTER TABLE marcom_sessions ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE marcom_sessions ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT NULL`;

    // Unique constraint on session_id is required for the ON CONFLICT (session_id)
    // upsert in saveSession(). If the table was created before migrate.js added it
    // (or created manually without it), the upsert would throw and saveSession()
    // would fail silently — leaving conversation_history at the [] default.
    // DO NOTHING on conflict so this is idempotent.
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'marcom_sessions'::regclass
            AND contype   = 'u'
            AND conname   = 'marcom_sessions_session_id_key'
        ) THEN
          ALTER TABLE marcom_sessions ADD CONSTRAINT marcom_sessions_session_id_key UNIQUE (session_id);
        END IF;
      END $$;
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_lastupdated
        ON marcom_sessions (user_id, last_updated DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_project_id
        ON marcom_sessions (project_id)
    `;
    logger.info('[chatSession] schema ensured');
  } catch (err) {
    logger.warn({ err: err.message }, '[chatSession] ensureSchema failed (non-fatal)');
  }
}

// ── Helpers ─────────────────────────────────────────────────
function deriveTitleFromMessages(messages) {
  if (!Array.isArray(messages)) return '';
  const firstUser = messages.find(m => m && m.role === 'user' && typeof m.content === 'string');
  if (!firstUser) return '';
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN);
}

function sanitizeTitle(t) {
  return (typeof t === 'string' ? t : '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN);
}

function trimMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-MAX_MESSAGES).map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    // Preserve any extra metadata the client sends (mode, service, ts, etc.)
    ...(m.meta    ? { meta: m.meta }      : {}),
    ...(m.mode    ? { mode: m.mode }      : {}),
    ...(m.service ? { service: m.service } : {}),
    ...(m.ts      ? { ts: m.ts }          : {}),
  }));
}

// ── Public API ──────────────────────────────────────────────

/**
 * List all chat sessions for a user — metadata only (no messages).
 * Sorted by last_updated DESC.
 */
/**
 * List chat sessions for a user.
 * @param {string}      userId
 * @param {string|null} [projectId]  — when provided, filter to that project only
 */
export async function listSessions(userId, projectId = null) {
  const sql = getDb();
  const rows = projectId
    ? await sql`
        SELECT session_id, title, conversation_history, last_updated
        FROM marcom_sessions
        WHERE user_id    = ${userId}
          AND project_id = ${projectId}
        ORDER BY last_updated DESC
        LIMIT 50
      `
    : await sql`
        SELECT session_id, title, conversation_history, last_updated
        FROM marcom_sessions
        WHERE user_id = ${userId}
        ORDER BY last_updated DESC
        LIMIT 50
      `;

  return rows.map(r => {
    // Defensive parse for legacy rows where JSONB may be a string.
    let hist = r.conversation_history;
    if (typeof hist === 'string') { try { hist = JSON.parse(hist); } catch { hist = []; } }

    return {
      sessionId: r.session_id,
      title:     r.title && r.title.trim()
                    ? r.title
                    : deriveTitleFromMessages(hist) || 'New Chat',
      updatedAt: r.last_updated,
    };
  });
}

/**
 * Load a single session's messages, scoped to userId.
 * Single query — userId match is the WHERE clause, so cross-user
 * lookups return null without leaking existence info.
 */
export async function getSession(userId, sessionId) {
  const sql = getDb();
  const rows = await sql`
    SELECT session_id, title, conversation_history, last_updated
    FROM marcom_sessions
    WHERE session_id = ${sessionId}
      AND user_id    = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];

  // Defensive parse: postgres.js auto-parses JSONB, but guard against
  // legacy rows where the value may have been stored as a JSON string.
  let rawHistory = r.conversation_history;
  if (typeof rawHistory === 'string') {
    try { rawHistory = JSON.parse(rawHistory); } catch { rawHistory = []; }
  }

  return {
    sessionId: r.session_id,
    title:     r.title || deriveTitleFromMessages(rawHistory) || 'New Chat',
    messages:  Array.isArray(rawHistory) ? rawHistory : [],
    updatedAt: r.last_updated,
  };
}

/**
 * Upsert a session. Cross-user safety:
 *   - INSERT path: brand-new sessionId, owned by this userId
 *   - UPDATE path: ON CONFLICT only fires for the SAME session_id, AND
 *     we add an explicit user_id WHERE check so a session_id collision
 *     across users (extremely unlikely given the prefixed format, but
 *     defensible) cannot overwrite another user's row.
 *
 * Returns { sessionId, title, updatedAt } — never returns the messages
 * payload (the client already has it).
 */
export async function saveSession(userId, { sessionId, title, messages, projectId = null }) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('saveSession: sessionId is required');
  }

  const sql = getDb();
  const cleanTitle    = sanitizeTitle(title) || deriveTitleFromMessages(messages) || 'New Chat';
  const cleanMessages = trimMessages(messages);
  const messagesJson  = JSON.stringify(cleanMessages);

  // Upsert pattern with explicit user_id ownership check.
  // Title overwrite policy:
  //   • Always update if the incoming title is real (not 'New Chat').
  //   • Allow overwriting a stale 'New Chat' placeholder once a real
  //     title becomes available.
  //   • Never downgrade a good title to 'New Chat' — protects against
  //     race conditions where a save fires before pushHistory completes.
  const rows = await sql`
    INSERT INTO marcom_sessions (
      session_id, user_id, title, conversation_history,
      current_mode, current_section, current_service,
      context_locked, service_history, project_id
    ) VALUES (
      ${sessionId}, ${userId}, ${cleanTitle}, ${messagesJson}::jsonb,
      1, 0, 0, false, ${'[]'}::jsonb, ${projectId}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      title = CASE
        WHEN EXCLUDED.title = 'New Chat' AND marcom_sessions.title <> '' AND marcom_sessions.title <> 'New Chat'
          THEN marcom_sessions.title
        ELSE EXCLUDED.title
      END,
      conversation_history = EXCLUDED.conversation_history,
      project_id = COALESCE(EXCLUDED.project_id, marcom_sessions.project_id)
    WHERE marcom_sessions.user_id = ${userId}
    RETURNING session_id, title, last_updated, user_id
  `;

  if (rows.length === 0) {
    // ON CONFLICT row exists but belongs to a different user — refuse
    throw Object.assign(new Error('saveSession: session belongs to a different user'), { status: 403 });
  }

  return {
    sessionId: rows[0].session_id,
    title:     rows[0].title,
    updatedAt: rows[0].last_updated,
  };
}

/**
 * Delete a session, scoped to userId. Returns true if a row was deleted,
 * false if not found or owned by a different user — callers map false to 404.
 *
 * The user_id is part of the WHERE clause, so cross-user deletes return
 * 0 affected rows without leaking existence info.
 */
export async function deleteSession(userId, sessionId) {
  if (!sessionId) return false;
  const sql = getDb();
  const rows = await sql`
    DELETE FROM marcom_sessions
    WHERE session_id = ${sessionId}
      AND user_id    = ${userId}
    RETURNING session_id
  `;
  return rows.length > 0;
}
