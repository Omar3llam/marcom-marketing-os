// ============================================================
// MARCOM — Export Router  (POST /api/export)
// Auth: Clerk requireAuth applied in server.js
// Validates session ownership before forwarding to n8n.
// ============================================================
import { Router } from 'express';
import { validate, exportSchema } from '../middleware/validate.js';
import { logger } from '../utils/logger.js';
import { getDb } from '../utils/db.js';
import { config } from '../config.js';

export const exportRouter = Router();

const N8N_WEBHOOK  = config.n8nExportWebhook;
const FWD_TIMEOUT  = 15_000;

exportRouter.post('/export', validate(exportSchema), async (req, res) => {
  const userId = req.userId;   // set by requireAuth

  try {
    const { session_id, export_type, payload, label } = req.body;

    // ── OWNERSHIP CHECK ───────────────────────────────────────
    if (session_id) {
      // In Postgres mode verify ownership; skip gracefully if DB unavailable
      try {
        const sql = getDb();
        const rows = await sql`
          SELECT id FROM marcom_sessions
          WHERE session_id = ${session_id}
            AND user_id    = ${userId}
          LIMIT 1
        `;
        if (rows.length === 0) {
          logger.warn({ userId, session_id }, 'Export ownership check failed');
          return res.status(403).json({ status: 'error', message: 'Forbidden: session does not belong to this user.' });
        }
      } catch (dbErr) {
        // DB not configured (Airtable dev mode) — skip ownership check
        logger.warn({ dbErr: dbErr.message }, 'DB ownership check skipped (DB unavailable)');
      }
    }

    // ── BUILD PAYLOAD FROM DB (never trust frontend payload) ─────
    let serverPayload = null;
    if (session_id) {
      try {
        const sql = getDb();
        const rows = await sql`
          SELECT conversation_history FROM marcom_sessions
          WHERE session_id = ${session_id}
            AND user_id    = ${userId}
          LIMIT 1
        `;
        if (rows.length > 0) {
          const history = Array.isArray(rows[0].conversation_history)
            ? rows[0].conversation_history
            : JSON.parse(rows[0].conversation_history || '[]');
          const lastAI = [...history].reverse().find(m => m.role === 'assistant');
          if (lastAI) {
            try { serverPayload = JSON.parse(lastAI.content); } catch {
              serverPayload = { raw_output: String(lastAI.content).slice(0, 5000) };
            }
          }
        }
      } catch (dbErr) {
        logger.warn({ dbErr: dbErr.message }, 'Could not load session payload from DB');
      }
    }

    const exportPackage = {
      source: 'MARCOM',
      user_id: userId,
      session_id: session_id || 'anonymous',
      export_type,
      label: label || export_type,
      timestamp: new Date().toISOString(),
      payload: serverPayload,  // built from DB — frontend payload is discarded
    };

    if (!N8N_WEBHOOK) {
      return res.json({
        status: 'ok',
        message: 'Export prepared. Configure N8N_EXPORT_WEBHOOK to enable auto-sync.',
        export_id: `EXP_${Date.now()}`,
        export_type,
        timestamp: exportPackage.timestamp,
        webhook_forwarded: false,
      });
    }

    // ── FORWARD TO n8n ────────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FWD_TIMEOUT);

    try {
      const fwdRes = await fetch(N8N_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MARCOM-ExportHub/4.0',
          'X-Webhook-Secret': config.webhookSecret,
        },
        body: JSON.stringify(exportPackage),
        signal: controller.signal,
      });

      logger.info({ export_type, userId, n8nStatus: fwdRes.status }, 'Export forwarded to n8n');

      return res.json({
        status: 'ok',
        message: fwdRes.ok ? 'Export synced to CRM.' : 'Forwarded but n8n returned non-OK.',
        export_id: `EXP_${Date.now()}`,
        export_type,
        timestamp: exportPackage.timestamp,
        webhook_forwarded: fwdRes.ok,
        webhook_status: fwdRes.status,
      });
    } catch (fwdErr) {
      logger.warn({ fwdErr: fwdErr.message }, 'n8n forward failed');
      return res.json({
        status: 'partial',
        message: 'Export prepared but CRM delivery failed. Check N8N_EXPORT_WEBHOOK.',
        export_id: `EXP_${Date.now()}`,
        export_type,
        webhook_forwarded: false,
        error: fwdErr.message,
      });
    } finally {
      clearTimeout(timer);
    }

  } catch (err) {
    logger.error({ err, userId }, 'Export router error');
    return res.status(500).json({
      status: 'error',
      message: 'Export failed. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    });
  }
});
