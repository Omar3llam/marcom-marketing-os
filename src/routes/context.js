// ============================================================
// MARCOM — User Context API
//   POST /api/context/save   { context }   → upsert by userId
//   GET  /api/context                       → { context: string|null }
//
// Backed by the `marcom_user_context` raw-SQL table (not Prisma).
// This route exists for legacy compatibility; new code should use
// the project-scoped context at POST/GET /api/projects/:id/context.
// ============================================================
import { Router } from 'express';
import { getDb }  from '../utils/db.js';
import { logger } from '../utils/logger.js';

export const contextRouter = Router();

// Defensive cap — wizard output runs ~600 chars; 16 KB is generous
// without giving us a way to be turned into a free key/value store.
const MAX_CONTEXT_LEN = 16_000;

// ── POST /api/context/save ──────────────────────────────────
contextRouter.post('/save', async (req, res) => {
  const userId = req.userId;
  const { context } = req.body || {};

  if (typeof context !== 'string' || !context.trim()) {
    return res.status(400).json({ error: 'context is required' });
  }
  if (context.length > MAX_CONTEXT_LEN) {
    return res.status(400).json({ error: 'context too large' });
  }

  try {
    const sql = getDb();
    await sql`
      INSERT INTO marcom_user_context (user_id, context, saved_at)
      VALUES (${userId}, ${context}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        context  = EXCLUDED.context,
        saved_at = NOW()
    `;
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, 'context.save failed');
    return res.status(500).json({ error: 'Save failed' });
  }
});

// ── GET /api/context ────────────────────────────────────────
contextRouter.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    const sql  = getDb();
    const rows = await sql`
      SELECT context FROM marcom_user_context
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    const ctx = rows[0]?.context ?? null;
    return res.json({ context: (typeof ctx === 'string' && ctx.trim()) ? ctx : null });
  } catch (err) {
    logger.error({ err, userId }, 'context.get failed');
    return res.status(500).json({ error: 'Lookup failed' });
  }
});
