// ============================================================
// MARCOM / Lumi — Measurement OS (attribution · incrementality)
// GATED behind Workspace.measurementTier (Agency/Enterprise depth, not core).
//   GET  /api/lumi/attribution?model=     — Attributed credit per channel
//   GET  /api/lumi/reconciliation         — platform vs blended vs incremental
//   GET/POST /api/lumi/incrementality      — list / design a holdout
//   POST /api/lumi/incrementality/:id/conclude — read out lift+CI → memory
// ============================================================
import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { getAttribution } from '../../services/attribution-engine/AttributionService.js';
import { ATTRIBUTION_MODEL, ATTRIBUTION_KNOWLEDGE } from '../../services/attribution-engine/attributionTypes.js';
import { getReconciliation } from '../../services/reconciliation/ReconciliationService.js';
import { designTest, listTests, getTest, recordCounts, concludeIncrementality } from '../../services/incrementality-engine/IncrementalityService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { requireMeasurementTier } from '../../middleware/requireMeasurementTier.js';
import { requirePlan }        from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

// Measurement (MEASURE surface) is STRATEGIST-only. The tier gate below blocks
// non-Agency workspaces; this blocks non-strategist SEATS within an enabled one.
const requireStrategist = requireCollabRole(WORKSPACE_ROLE.STRATEGIST);

export const measurementRouter = Router();

const MEASURE_PATHS = ['/attribution', '/reconciliation', '/incrementality'];

// TWO stacked gates, plan first so the actionable message is "upgrade to PRO"
// before "measurement not enabled". They are DELIBERATELY distinct axes:
//   requirePlan('PRO')     — the workspace's billing entitlement (this paywall)
//   requireMeasurementTier — attribution depth (Agency/Enterprise), independent
// A PRO workspace with measurementTier=NONE still 403s the second gate — that's
// intended (measurement is deeper than the base PRO plan), not a bug.
measurementRouter.use(MEASURE_PATHS, requirePlan('PRO'));
measurementRouter.use(MEASURE_PATHS, (req, res, next) => requireMeasurementTier(req, res, next));

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/attribution?model= — Attributed credit per channel
// ─────────────────────────────────────────────────────────────
measurementRouter.get('/attribution', async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  const model = req.query.model && Object.values(ATTRIBUTION_MODEL).includes(req.query.model)
    ? req.query.model : ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED;
  try {
    const attribution = await getAttribution(wsId, { model });
    // C-06 — INSUFFICIENT_DATA (NOT_ENOUGH) and EVIDENCE_UNAVAILABLE
    // (COULD_NOT_LOOK) are two different absences with two different fixes, and
    // the token says which without the reader learning this vocabulary.
    const knowledge = ATTRIBUTION_KNOWLEDGE.knowledgeOf(attribution?.status);
    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      attribution: knowledge ? { ...attribution, knowledge } : attribution,
    });
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

measurementRouter.post('/incrementality', requireStrategist, async (req, res) => {
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
// POST /api/lumi/incrementality/:id/metrics — record OBSERVED counts
// (the operator-entered holdout result; DESIGNED → RUNNING). The missing
// write organ that makes a conclude meaningful — without it every readout
// would be computed off empty arms.
// ─────────────────────────────────────────────────────────────
measurementRouter.post('/incrementality/:id/metrics', requireStrategist, async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  const b = req.body ?? {};
  const fields = ['exposedUsers', 'exposedConversions', 'holdoutUsers', 'holdoutConversions'];
  if (fields.some((f) => typeof b[f] !== 'number')) {
    return res.status(400).json({ error: 'BadCounts', message: 'exposedUsers, exposedConversions, holdoutUsers, holdoutConversions (numbers) required.' });
  }
  try {
    const test = await recordCounts(wsId, req.params.id, b);
    return res.json({ workspaceId: wsId, test });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'HoldoutNotFound', message: err.message });
    if (err.code === 'HOLDOUT_CONFLICT') return res.status(409).json({ error: 'HoldoutConflict', message: err.message });
    if (err.code === 'INVALID_HOLDOUT_COUNTS') return res.status(400).json({ error: 'BadCounts', message: err.message });
    if (/must be|cannot exceed|immutable/i.test(err.message)) return res.status(400).json({ error: 'BadCounts', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/measurement] record counts failed');
    return res.status(500).json({ error: 'RecordCountsFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/incrementality/:id/conclude — read out lift+CI → memory
// ─────────────────────────────────────────────────────────────
measurementRouter.post('/incrementality/:id/conclude', requireStrategist, async (req, res) => {
  const wsId = req.measurementWorkspaceId;
  try {
    const result = await concludeIncrementality(wsId, req.params.id);
    logger.info({ wsId, testId: req.params.id, conclusive: result.readout.conclusive }, '[lumi/measurement] holdout concluded');
    return res.status(201).json({ workspaceId: wsId, ...result });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'HoldoutNotFound', message: err.message });
    if (err.code === 'HOLDOUT_CONFLICT') return res.status(409).json({ error: 'HoldoutConflict', message: err.message });
    if (err.code === 'INVALID_HOLDOUT_COUNTS') return res.status(400).json({ error: 'BadCounts', message: err.message });
    if (/no observed counts/i.test(err.message)) return res.status(409).json({ error: 'NoObservedCounts', message: err.message });
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
