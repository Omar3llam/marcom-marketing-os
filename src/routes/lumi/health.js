// ============================================================
// MARCOM / Lumi — Health check
// GET /api/lumi/_health
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }      from 'express';
import { prisma }      from '../../lib/prisma.js';
import { executionQueue } from '../../queues/index.js';
import { getOrchestratorHealth } from '../../resilience/orchestratorCircuit.js';

export const healthRouter = Router();

// ─────────────────────────────────────────────────────────────
healthRouter.get('/_health', async (_req, res) => {
  try {
    // R13-D / B3-C — this reported the depth of the retired `actions` queue,
    // which no process consumes any more. Repointed at the queue that carries
    // real platform mutations, so "queue" on this endpoint describes work that
    // can actually be performed.
    //
    // `legacyActions` stays: the Action table is still read by the feed,
    // intelligence and the agentic loop, so its row count is a real number about
    // real (historical) rows. It is named for what it is rather than left as
    // the unqualified `actions`, which now would suggest live work.
    const legacyActions = await prisma.action.count().catch(() => null);
    let queue = null;
    if (executionQueue) {
      try {
        queue = await executionQueue.getJobCounts('waiting', 'active', 'failed', 'completed');
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
      legacyActions,
      queue,
      orchestrator,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
