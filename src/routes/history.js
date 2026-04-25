// ============================================================
// MARCOM — Chat History API  (POST /api/history/save,
//                             GET  /api/history/list,
//                             GET  /api/history/:sessionId)
//
// Auth: relies on src/middleware/clerkAuth.js#requireAuth, which is
// applied at the /api router level in server.js. requireAuth verifies
// the Bearer token via Clerk and sets req.userId. We do not duplicate
// token verification here — that would re-implement the existing
// middleware path with no benefit.
//
// All three handlers are user-scoped: every query filters on
// req.userId so a user can never read or overwrite another user's row.
// ============================================================
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { listSessions, getSession, saveSession, deleteSession } from '../models/chatSession.js';

export const historyRouter = Router();

// ── POST /api/history/save ──────────────────────────────────
// Body: { sessionId, title?, messages: [{role, content, ...}] }
// Upsert by sessionId; cross-user overwrites are blocked at the model.
historyRouter.post('/save', async (req, res) => {
  const userId = req.userId;
  const { sessionId, title, messages } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  try {
    const saved = await saveSession(userId, { sessionId, title, messages });
    return res.json({ ok: true, sessionId: saved.sessionId, title: saved.title, updatedAt: saved.updatedAt });
  } catch (err) {
    if (err.status === 403) {
      logger.warn({ userId, sessionId }, 'history.save blocked — cross-user overwrite attempt');
      return res.status(403).json({ error: 'Forbidden' });
    }
    logger.error({ err, userId, sessionId }, 'history.save failed');
    return res.status(500).json({ error: 'Save failed' });
  }
});

// ── GET /api/history/list ───────────────────────────────────
// Returns metadata only — no message arrays — so the sidebar
// payload stays small even with many sessions.
historyRouter.get('/list', async (req, res) => {
  const userId = req.userId;
  try {
    const sessions = await listSessions(userId);
    return res.json({ sessions });
  } catch (err) {
    logger.error({ err, userId }, 'history.list failed');
    return res.status(500).json({ error: 'List failed' });
  }
});

// ── GET /api/history/:sessionId ─────────────────────────────
// Single query — userId is part of the WHERE clause, so a 404
// covers both "not found" and "belongs to a different user".
historyRouter.get('/:sessionId', async (req, res) => {
  const userId = req.userId;
  const { sessionId } = req.params;

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  try {
    const session = await getSession(userId, sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    return res.json(session);
  } catch (err) {
    logger.error({ err, userId, sessionId }, 'history.get failed');
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── DELETE /api/history/:sessionId ──────────────────────────
// 404 covers both "not found" and "belongs to a different user" — the
// model's WHERE clause filters on userId, so cross-user deletes return
// 0 affected rows and never leak existence info.
historyRouter.delete('/:sessionId', async (req, res) => {
  const userId = req.userId;
  const { sessionId } = req.params;

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  try {
    const ok = await deleteSession(userId, sessionId);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId, sessionId }, 'history.delete failed');
    return res.status(500).json({ error: 'Delete failed' });
  }
});
