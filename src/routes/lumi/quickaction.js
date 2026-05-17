// ============================================================
// MARCOM / Lumi — Quick Action handler (HMAC-signed links)
// POST /api/lumi/quick-action
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }           from 'express';
import { prisma }           from '../../lib/prisma.js';
import { enqueueAction }    from '../../queues/index.js';
import { verifyQuickAction } from '../../utils/hmac.js';
import { logger }           from '../../utils/logger.js';

export const quickActionRouter = Router();

// Rollback window: an action becomes immutable after 24h.
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
export async function quickActionHandler(req, res) {
  const { token, sig } = req.body || {};
  const v = verifyQuickAction({ token, sig });
  if (!v.ok) {
    return res.status(401).json({ error: 'InvalidQuickAction', reason: v.reason });
  }

  try {
    const action = await prisma.action.findUnique({ where: { id: v.actionId } });
    if (!action) return res.status(404).json({ error: 'Action not found' });

    // Quick actions can only push PENDING rows forward; everything
    // else requires a fully-authenticated session.
    if (action.status !== 'PENDING') {
      return res.status(409).json({
        error: 'NotEnqueueable',
        reason: `status is ${action.status}`,
      });
    }

    if (v.scope === 'rollback') {
      // Same window check as the JWT route
      if (!action.executedAt ||
          Date.now() - new Date(action.executedAt).getTime() > ROLLBACK_WINDOW_MS) {
        return res.status(410).json({ error: 'RollbackWindowExpired' });
      }
    }

    await enqueueAction(action);
    return res.json({ ok: true, enqueued: true, actionId: action.id });

  } catch (err) {
    logger.error({ err: err.message }, '[lumi/quick-action] failed');
    return res.status(500).json({ error: 'EnqueueFailed', message: err.message });
  }
}

quickActionRouter.post('/', quickActionHandler);
