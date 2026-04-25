// ============================================================
// MARCOM — User Context API
//   POST /api/context/save   { context }   → upsert by Clerk userId
//   GET  /api/context                       → { context: string|null }
//
// Auth: req.userId is set by src/middleware/clerkAuth.js#requireAuth,
// which is applied at the /api router level in server.js.
// ============================================================
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { saveUserContext, getUserContext } from '../models/userContext.js';

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
    await saveUserContext(userId, context);
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
    const context = await getUserContext(userId);
    return res.json({ context });   // null when not yet onboarded
  } catch (err) {
    logger.error({ err, userId }, 'context.get failed');
    return res.status(500).json({ error: 'Lookup failed' });
  }
});
