// ============================================================
// MARCOM — Airtable Session Manager (Legacy / Fallback)
// NOTE: Production should use sessionStore.js (PostgreSQL).
// This file is kept for local dev without a Postgres instance.
// All filterByFormula inputs are sanitised against injection.
// ============================================================
import Airtable from 'airtable';
import { logger } from './logger.js';

const base  = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = process.env.AIRTABLE_TABLE_NAME || 'MARCOM_Sessions';

// ── SANITIZE FORMULA INPUT ────────────────────────────────────
function sanitizeFormula(str) {
  if (typeof str !== 'string') return '';
  // Strip single quotes, backslashes, and limit length
  return str.replace(/['\\]/g, '').slice(0, 100);
}

export async function getOrCreateSession(sessionId, userId = 'anon') {
  if (sessionId) {
    const safe = sanitizeFormula(sessionId);
    const safeUser = sanitizeFormula(userId);
    try {
      const records = await base(TABLE).select({
        filterByFormula: `AND({session_id}='${safe}', {user_id}='${safeUser}')`,
        maxRecords: 1,
      }).firstPage();
      if (records.length > 0) return parseRecord(records[0]);
    } catch (err) {
      logger.error({ err }, '[AIRTABLE] Load session error');
    }
  }
  return createSession(userId);
}

async function createSession(userId = 'anon') {
  const newId = `MARCOM_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const record = await base(TABLE).create({
    session_id: newId, user_id: userId,
    current_mode: 1, current_section: 0, current_service: 0,
    context_locked: false,
    conversation_history: '[]', service_history: '[]',
    active_service_context: '{}',
    content_interrogation_log: '', campaign_analysis_log: '', hybrid_raw_data: '',
    status: 'active',
    created_at: new Date().toISOString(), last_updated: new Date().toISOString(),
  });
  return parseRecord(record);
}

export async function updateSession(recordId, userId = 'anon', fields) {
  // Support legacy 2-arg call signature (recordId, fields) from old code
  if (typeof userId === 'object' && fields === undefined) {
    fields = userId;
    userId = 'anon';
  }
  try {
    const safeFields = {};
    for (const [k, v] of Object.entries(fields)) {
      safeFields[k] = typeof v === 'string' && v.length > 95_000 ? v.slice(-95_000) : v;
    }
    const record = await base(TABLE).update(recordId, safeFields);
    return parseRecord(record);
  } catch (err) {
    logger.error({ err }, '[AIRTABLE] Update session error');
    throw err;
  }
}

function parseRecord(record) {
  const f = record.fields;
  let conversationHistory = [], serviceHistory = [];
  try { conversationHistory = JSON.parse(f.conversation_history || '[]'); } catch {}
  try { serviceHistory      = JSON.parse(f.service_history      || '[]'); } catch {}
  return {
    recordId: record.id, session_id: f.session_id, user_id: f.user_id || 'anon',
    current_mode:    parseInt(f.current_mode)    || 1,
    current_section: parseInt(f.current_section) || 0,
    current_service: parseInt(f.current_service) || 0,
    context_locked: f.context_locked || false,
    context_summary: f.context_summary || '',
    conversation_history: conversationHistory,
    service_history:      serviceHistory,
    content_interrogation_log: f.content_interrogation_log || '',
    campaign_analysis_log:     f.campaign_analysis_log     || '',
    hybrid_raw_data:           f.hybrid_raw_data           || '',
    status: f.status || 'active',
  };
}
