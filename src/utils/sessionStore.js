// ============================================================
// MARCOM — Session Store (PostgreSQL)
// Replaces Airtable-based session management.
// All queries are parameterised — no string interpolation.
// ============================================================
import { getDb } from './db.js';
import { logger } from './logger.js';

const MAX_HISTORY   = 40;
const MAX_LOG_CHARS = 90_000;

// ── HELPERS ─────────────────────────────────────────────────
function trimLog(existing = '', addition = '') {
  const joined = existing + '\n' + addition;
  return joined.length > MAX_LOG_CHARS
    ? joined.slice(-MAX_LOG_CHARS)
    : joined;
}

function trimHistory(arr = []) {
  return arr.slice(-MAX_HISTORY);
}

function parseRow(row) {
  return {
    recordId:                row.id,
    session_id:              row.session_id,
    user_id:                 row.user_id,
    current_mode:            row.current_mode,
    current_section:         row.current_section,
    current_service:         row.current_service,
    context_locked:          row.context_locked,
    context_summary:         row.context_summary || '',
    conversation_history:    Array.isArray(row.conversation_history) ? row.conversation_history : [],
    service_history:         Array.isArray(row.service_history)      ? row.service_history      : [],
    content_interrogation_log: row.content_interrogation_log || '',
    campaign_analysis_log:     row.campaign_analysis_log    || '',
    hybrid_raw_data:           row.hybrid_raw_data          || '',
    status:                  row.status || 'active',
  };
}

// ── PUBLIC API ───────────────────────────────────────────────

/**
 * Load an existing session (scoped to userId) or create a fresh one.
 * @param {string|null} sessionId
 * @param {string}      userId     — Clerk userId; required for ownership
 */
export async function getOrCreateSession(sessionId, userId) {
  const sql = getDb();

  if (sessionId) {
    const rows = await sql`
      SELECT * FROM marcom_sessions
      WHERE session_id = ${sessionId}
        AND user_id    = ${userId}
      LIMIT 1
    `;
    if (rows.length > 0) return parseRow(rows[0]);
    logger.warn({ sessionId, userId }, 'Session not found or ownership mismatch — creating new');
  }

  const newId = `MARCOM_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const rows = await sql`
    INSERT INTO marcom_sessions (
      session_id, user_id, current_mode, current_section, current_service,
      context_locked, conversation_history, service_history
    ) VALUES (
      ${newId}, ${userId}, 1, 0, 0,
      false, ${'[]'}::jsonb, ${'[]'}::jsonb
    )
    RETURNING *
  `;
  return parseRow(rows[0]);
}

/**
 * Update a session. Enforces userId ownership before writing.
 * @param {string} recordId  — UUID primary key
 * @param {string} userId
 * @param {object} fields
 */
export async function updateSession(recordId, userId, fields) {
  const sql = getDb();

  // Trim history / logs before persisting
  const conversationHistory = trimHistory(
    Array.isArray(fields.conversation_history) ? fields.conversation_history : []
  );

  const rows = await sql`
    UPDATE marcom_sessions SET
      current_mode      = ${fields.current_mode        ?? 1},
      current_section   = ${fields.current_section     ?? 0},
      current_service   = ${fields.current_service     ?? 0},
      context_locked    = ${fields.context_locked      ?? false},
      context_summary   = ${fields.context_summary     ?? ''},
      conversation_history = ${JSON.stringify(conversationHistory)}::jsonb,
      service_history   = ${JSON.stringify(fields.service_history ?? [])}::jsonb,
      content_interrogation_log = ${trimLog(fields.content_interrogation_log)},
      campaign_analysis_log     = ${trimLog(fields.campaign_analysis_log)},
      hybrid_raw_data   = ${(fields.hybrid_raw_data ?? '').slice(0, 10_000)},
      status            = ${fields.status ?? 'active'}
    WHERE id      = ${recordId}
      AND user_id = ${userId}
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new Error(`updateSession: record ${recordId} not found or ownership mismatch`);
  }
  return parseRow(rows[0]);
}
