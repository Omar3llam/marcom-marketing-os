// ============================================================
// MARCOM / Lumi — Health check
// GET /api/lumi/_health
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }      from 'express';
import { prisma }      from '../../lib/prisma.js';
import { executionQueue } from '../../queues/index.js';

export const healthRouter = Router();

// ─────────────────────────────────────────────────────────────
healthRouter.get('/_health', async (_req, res) => {
  try {
    // R13-D / B3-C — this reported the depth of the retired `actions` queue,
    // which no process consumes any more. Repointed at the queue that carries
    // real platform mutations, so "queue" on this endpoint describes work that
    // can actually be performed.
    //
    // `legacyActions` stays, but S1-B changed what it means. It used to be one
    // reader among several; removing the feed's and intelligence's Action reads
    // — and the `action.update` inside the retired orchestrator — leaves this
    // count as the LAST reference to the table anywhere in production, and the
    // table with no writer at all.
    //
    // Kept deliberately: it is a diagnostic row count of real historical rows,
    // and it is the only thing that can still say how many there are. Retiring
    // the model itself is a schema slice, which is where this line goes with it.
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

    // S1-B — the `orchestrator` field is gone. It reported the circuit-breaker
    // state around runOrchestration, which was removed with the CampaignState
    // population it read: a breaker protecting a function that no longer exists
    // reports on nothing. Zero client consumers.
    res.json({
      ok: true,
      legacyActions,
      queue,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
