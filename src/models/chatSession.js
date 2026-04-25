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
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_lastupdated
        ON marcom_sessions (user_id, last_updated DESC)
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
export async function listSessions(userId) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      session_id,
      title,
      conversation_history,
      last_updated
    FROM marcom_sessions
    WHERE user_id = ${userId}
    ORDER BY last_updated DESC
    LIMIT 50
  `;

  return rows.map(r => ({
    sessionId: r.session_id,
    // Fall back to deriving from first user message when title is empty (old rows)
    title:     r.title && r.title.trim()
                  ? r.title
                  : deriveTitleFromMessages(r.conversation_history) || 'New Chat',
    updatedAt: r.last_updated,
  }));
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
  return {
    sessionId: r.session_id,
    title:     r.title || deriveTitleFromMessages(r.conversation_history) || 'New Chat',
    messages:  Array.isArray(r.conversation_history) ? r.conversation_history : [],
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
export async function saveSession(userId, { sessionId, title, messages }) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('saveSession: sessionId is required');
  }

  const sql = getDb();
  const cleanTitle    = sanitizeTitle(title) || deriveTitleFromMessages(messages) || 'New Chat';
  const cleanMessages = trimMessages(messages);
  const messagesJson  = JSON.stringify(cleanMessages);

  // Upsert pattern with explicit user_id ownership check.
  // The DO UPDATE WHERE clause is the cross-user safety net.
  const rows = await sql`
    INSERT INTO marcom_sessions (
      session_id, user_id, title, conversation_history,
      current_mode, current_section, current_service,
      context_locked, service_history
    ) VALUES (
      ${sessionId}, ${userId}, ${cleanTitle}, ${messagesJson}::jsonb,
      1, 0, 0, false, ${'[]'}::jsonb
    )
    ON CONFLICT (session_id) DO UPDATE SET
      title                = EXCLUDED.title,
      conversation_history = EXCLUDED.conversation_history
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
