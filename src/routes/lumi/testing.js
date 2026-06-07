// ============================================================
// MARCOM / Lumi — Testing OS (closed-loop weekly experiments)
// GET  /api/lumi/tests              — weekly agenda + experiments (JWT)
// POST /api/lumi/tests              — commit picked suggestions
// POST /api/lumi/tests/:id/start    — PROPOSED → RUNNING
// POST /api/lumi/tests/:id/metrics  — record variant counts (CI/demo)
// POST /api/lumi/tests/:id/conclude — loop closure → winner + verdict
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getWeeklyAgenda, commitAgenda } from '../../services/test-generator/TestGeneratorService.js';
import { startTest, recordVariantMetrics, concludeTest } from '../../services/test-tracker/TestTrackerService.js';

export const testingRouter = Router();

// Resolve workspaceId — mirrors lumi/feed.js + portfolio.js. Never
// fabricate a synthetic id (workspaceId columns are @db.Uuid).
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/testing] workspaceId fallback failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/tests   — ranked agenda + current experiments
// ─────────────────────────────────────────────────────────────
testingRouter.get('/tests', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) {
    return res.json({ workspaceId: null, generatedAt: new Date().toISOString(), agenda: [], experiments: [] });
  }
  try {
    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const [agenda, experiments] = await Promise.all([
      getWeeklyAgenda(wsId),
      prisma.testExperiment.findMany({
        where:   { workspaceId: wsId, ...(statusFilter && { status: statusFilter }) },
        orderBy: { createdAt: 'desc' },
        take:    100,
        include: { variants: true },
      }),
    ]);
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), agenda, experiments });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/testing] list failed');
    return res.status(500).json({ error: 'TestsUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests   — commit picked suggestions → PROPOSED tests
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  if (picks.length === 0) return res.status(400).json({ error: 'BadRequest', message: 'picks[] is required' });

  try {
    const result = await commitAgenda(wsId, picks);
    return res.status(201).json({ workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/testing] commit failed');
    return res.status(500).json({ error: 'TestCommitFailed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/start   — PROPOSED → RUNNING
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/start', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const test = await startTest(req.params.id);
    return res.json({ workspaceId: wsId, test });
  } catch (err) {
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] start failed');
    return res.status(500).json({ error: 'TestStartFailed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/metrics   — record variant counts
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/metrics', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const rows = Array.isArray(req.body?.variants) ? req.body.variants : [];
  if (rows.length === 0) return res.status(400).json({ error: 'BadRequest', message: 'variants[] is required' });

  try {
    const result = await recordVariantMetrics(req.params.id, rows);
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] metrics failed');
    return res.status(500).json({ error: 'TestMetricsFailed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/conclude   — THE LOOP
// Reads the winner honestly, writes the outcome to memory, and (when
// confident + governance-valid) emits a PROPOSED REFRESH/SCALE Decision
// that the user confirms through the existing execute path. Never
// auto-executes.
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/conclude', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const result = await concludeTest(req.params.id);
    logger.info({ wsId, testId: req.params.id, verdict: result.verdict, decisionId: result.decisionId }, '[lumi/testing] concluded');
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] conclude failed');
    return res.status(500).json({ error: 'TestConcludeFailed', message: err.message });
  }
});
