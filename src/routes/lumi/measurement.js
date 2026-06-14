// ============================================================
// MARCOM / Lumi — Measurement OS (attribution · incrementality)
// GATED behind Workspace.measurementTier (Agency/Enterprise depth, not core).
//   GET  /api/lumi/attribution?model=     — Attributed credit per channel
//   GET  /api/lumi/reconciliation         — platform vs blended vs incremental
//   GET/POST /api/lumi/incrementality      — list / design a holdout
//   POST /api/lumi/incrementality/:id/conclude — read out lift+CI → memory
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getAttribution } from '../../services/attribution-engine/AttributionService.js';
import { ATTRIBUTION_MODEL } from '../../services/attribution-engine/attributionTypes.js';
import { getReconciliation } from '../../services/reconciliation/ReconciliationService.js';
import { designTest, listTests, getTest, concludeIncrementality } from '../../services/incrementality-engine/IncrementalityService.js';

export const measurementRouter = Router();

// Resolve workspaceId — mirrors lumi/planning.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/measurement] workspaceId fallback failed');
    return null;
  }
}

// ── The tier gate (the honesty/product seam) ──────────────────
// Measurement is Agency/Enterprise depth, OFF by default. NONE → 403.
// Resolves the workspace once and stashes it on req for the handlers.
async function requireMeasurementTier(req, res, next) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const override = process.env.MEASUREMENT_TIER_OVERRIDE; // dev/local escape hatch
  let tier = override;
  if (!tier) {
    const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { measurementTier: true } });
    tier = ws?.measurementTier ?? 'NONE';
  }
  if (tier === 'NONE') {
    return res.status(403).json({ error: 'MeasurementGated', tier: 'NONE', message: 'Measurement is an Agency/Enterprise capability — not enabled for this workspace.' });
  }
  req.measurementWorkspaceId = wsId;
  req.measurementTier = tier;
  next();
}

measurementRouter.use(['/attribution', '/reconciliation', '/incrementality'], (req, res, next) => requireMeasurementTier(req, res, next));

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/attribution?model= — Attributed credit per channel
// ─────────────────────────────────────────────────────────────
measurementRouter.get('/attribution', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  const model = req.query.model && Object.values(ATTRIBUTION_MODEL).includes(req.query.model)
    ? req.query.model : ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED;
  try {
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), attribution: await getAttribution(wsId, { model }) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/measurement] attribution failed');
    return res.status(500).json({ error: 'AttributionUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/reconciliation — platform vs blended vs incremental
// ─────────────────────────────────────────────────────────────
measurementRouter.get('/reconciliation', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  try {
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...(await getReconciliation(wsId)) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/measurement] reconciliation failed');
    return res.status(500).json({ error: 'ReconciliationUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET  /api/lumi/incrementality — list holdouts
// POST /api/lumi/incrementality — design a holdout (power calc)
// ─────────────────────────────────────────────────────────────
measurementRouter.get('/incrementality', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  try {
    return res.json({ workspaceId: wsId, tests: await listTests(wsId) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/measurement] incrementality list failed');
    return res.status(500).json({ error: 'IncrementalityUnavailable', message: 'Request failed' });
  }
});

measurementRouter.post('/incrementality', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  const b = req.body ?? {};
  if (!b.channel || typeof b.baselineCvr !== 'number' || typeof b.mde !== 'number' || typeof b.dailyEligible !== 'number') {
    return res.status(400).json({ error: 'BadHoldout', message: 'channel, baselineCvr, mde, dailyEligible required.' });
  }
  try {
    const test = await designTest(wsId, b);
    return res.status(201).json({ workspaceId: wsId, test });
  } catch (err) {
    const bad = /baselineCvr|mde|dailyEligible|required/i.test(err.message);
    if (bad) return res.status(400).json({ error: 'BadHoldout', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/measurement] holdout design failed');
    return res.status(500).json({ error: 'HoldoutDesignFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/incrementality/:id/conclude — read out lift+CI → memory
// ─────────────────────────────────────────────────────────────
measurementRouter.post('/incrementality/:id/conclude', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  try {
    const result = await concludeIncrementality(wsId, req.params.id);
    logger.info({ wsId, testId: req.params.id, conclusive: result.readout.conclusive }, '[lumi/measurement] holdout concluded');
    return res.status(201).json({ workspaceId: wsId, ...result });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'HoldoutNotFound', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/measurement] conclude failed');
    return res.status(500).json({ error: 'ConcludeFailed', message: 'Request failed' });
  }
});

// GET so the tier-gate middleware also has a route to attach to.
measurementRouter.get('/incrementality/:id', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  try {
    const test = await getTest(wsId, req.params.id);
    if (!test) return res.status(404).json({ error: 'HoldoutNotFound' });
    return res.json({ workspaceId: wsId, test });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/measurement] get holdout failed');
    return res.status(500).json({ error: 'IncrementalityUnavailable', message: 'Request failed' });
  }
});
