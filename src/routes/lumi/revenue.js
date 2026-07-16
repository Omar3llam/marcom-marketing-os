// ============================================================
// MARCOM / Lumi — Revenue upload (manual actuals)
// POST /api/lumi/revenue/csv — match campaign rows → land MANUAL revenue actuals
// ------------------------------------------------------------
// STRATEGIST-only (revenue is a portfolio-truth input). The client parses the
// CSV + maps columns, then POSTs structured rows — the backend never sees a raw
// file. Capped at MAX_REVENUE_CSV_ROWS to bound the work per request.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { processRevenueCsv, MAX_REVENUE_CSV_ROWS } from '../../services/revenue/RevenueCsvService.js';
import { runSweep } from '../../services/agentic-loop/AgenticLoopService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';

const requireStrategist = requireCollabRole(WORKSPACE_ROLE.STRATEGIST);

export const revenueRouter = Router();

// Resolve workspaceId — mirrors lumi/planning.js. Never fabricate a synthetic id.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/revenue] workspaceId fallback failed');
    return null;
  }
}

revenueRouter.post('/revenue/csv', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const rows = req.body?.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'InvalidBody', message: 'rows must be an array.' });
  if (rows.length === 0) return res.status(400).json({ error: 'EmptyUpload', message: 'No rows to process.' });
  if (rows.length > MAX_REVENUE_CSV_ROWS) {
    return res.status(400).json({ error: 'TooManyRows', message: `Max ${MAX_REVENUE_CSV_ROWS} rows per upload.` });
  }

  try {
    const result = await processRevenueCsv(wsId, rows);

    // Re-score the revenue we just landed, so ROAS verdicts appear without the
    // operator having to ask for a sweep. DELIBERATELY NOT AWAITED: runSweep
    // fans out to the reasoning pre-generation + the portfolio advisory (LLM
    // round-trips measured in tens of seconds), which would push this response
    // past a proxy's request timeout. The caller needs the match results now;
    // the verdicts follow a moment later, and the UI's "Run sweep now" button
    // remains the instant path. force:true because THIS upload is the reason to
    // re-score — the 15-minute idempotency window would otherwise reuse a
    // pre-upload agenda and the new revenue would go unread.
    if (result.updated > 0) {
      runSweep(wsId, { trigger: 'MANUAL', force: true }).catch((err) =>
        logger.warn({ err: err.message, workspaceId: wsId }, '[lumi/revenue] post-upload sweep failed — revenue still landed'),
      );
    }

    return res.json(result);
  } catch (err) {
    logger.error({ err: err.message, workspaceId: wsId }, '[lumi/revenue] processRevenueCsv failed');
    return res.status(500).json({ error: 'RevenueProcessingFailed' });
  }
});
