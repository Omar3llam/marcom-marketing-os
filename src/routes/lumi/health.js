// ============================================================
// MARCOM / Lumi — Health check
// GET /api/lumi/_health
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }      from 'express';
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
    // SC-2 — `legacyActions` is gone, and this is the schema slice the comment
    // that used to sit here promised it would leave in. It was a diagnostic row
    // count kept for one reason: it was the only thing left that could say how
    // many historical rows the table held. Production answered that question
    // directly — 0 rows, 0 workspaces, no earliest and no latest — and then the
    // table was dropped.
    //
    // The field is ABSENT rather than 0 or null. A count of a table that does
    // not exist is not a measurement, and this endpoint's whole job is to say
    // what is true. Nothing read it: no client, no monitoring config, no other
    // service. Render's health check is /api/health, not this route.
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
      queue,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});
