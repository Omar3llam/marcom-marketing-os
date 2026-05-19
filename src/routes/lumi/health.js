// ============================================================
// MARCOM / Lumi — Health check
// GET /api/lumi/_health
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }      from 'express';
import { prisma }      from '../../lib/prisma.js';
import { actionQueue } from '../../queues/index.js';
import { getOrchestratorHealth } from '../../resilience/orchestratorCircuit.js';

export const healthRouter = Router();

// ─────────────────────────────────────────────────────────────
healthRouter.get('/_health', async (_req, res) => {
  try {
    const actions = await prisma.action.count().catch(() => null);
    let queue = null;
    if (actionQueue) {
      try {
        queue = await actionQueue.getJobCounts('waiting', 'active', 'failed', 'completed');
      } catch (err) {
        queue = { error: err.message };
      }
    } else {
      queue = { disabled: true, reason: 'REDIS_URL not configured' };
    }

    // Circuit breaker health (Phase 11B)
    const orchestrator = getOrchestratorHealth();

    res.json({
      ok: true,
      actions,
      queue,
      orchestrator,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
