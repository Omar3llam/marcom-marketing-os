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
import { startTest, recordVariantMetrics, concludeTest, promoteTestToHoldout, getTestById } from '../../services/test-tracker/TestTrackerService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { requireMeasurementTier } from '../../middleware/requireMeasurementTier.js';
import { requirePlan }        from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

// Testing is a BUYER/STRATEGIST surface (TESTING is not in a CLIENT's visibleStates).
const requireOperator = requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST);
// Designing a holdout is a STRATEGIST act (mirrors lumi/measurement.js).
const requireStrategist = requireCollabRole(WORKSPACE_ROLE.STRATEGIST);

export const testingRouter = Router();

// ── Plan gate (PRO) ──────────────────────────────────────────
// The whole Testing OS surface is PRO — but SCOPE the gate to '/tests', never a
// path-less router-wide use(). Every lumi sub-router is flat-mounted at '/' on
// lumiRouter, so a request for a LATER sibling (connections, copilot, entities,
// revenue, …) still passes through this router's stack first. A path-less
// use(requirePlan('PRO')) would therefore 403 those FREE/GROWTH surfaces before
// they ever reach their handler. Path-scoping confines the gate to this
// router's own /tests* routes. Runs before the per-route role gates below.
testingRouter.use('/tests', requirePlan('PRO'));

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
    return res.status(500).json({ error: 'TestsUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/tests/:id   — ONE experiment, by its own id
// ─────────────────────────────────────────────────────────────
// C-13 · B7-03's carried consequence: "Experiment → that experiment,
// resolvable without going through entityId". The holdout half has had this
// read since Phase 7C (`GET /incrementality/:id`); the A/B half never did.
//
// No role gate, matching the list it came from: reading an experiment is not
// an act. The PRO gate above already covers it — `use('/tests', …)` matches
// this path too — and a by-id read more permissive than its own list would be
// a way around that gate.
//
// Declared openly: this ships with no client caller. B7-03 named the consumer
// in advance and `testing.detail.test.js` is its reader of record until B7
// builds the destination. Nobody wrote that sentence for
// `GET /incrementality/:id`, which is why it has sat callerless since Phase 7C.
testingRouter.get('/tests/:id', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const test = await getTestById(wsId, req.params.id);
    // 404 for "not yours" as well as "not there". Distinguishing them would
    // confirm the row exists to someone who may not see it.
    if (!test) return res.status(404).json({ error: 'TestNotFound', message: 'No such experiment in this workspace.' });
    return res.json({ workspaceId: wsId, test });
  } catch (err) {
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] get test failed');
    return res.status(500).json({ error: 'TestUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests   — commit picked suggestions → PROPOSED tests
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests', requireOperator, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  if (picks.length === 0) return res.status(400).json({ error: 'BadRequest', message: 'picks[] is required' });

  try {
    const result = await commitAgenda(wsId, picks);
    return res.status(201).json({ workspaceId: wsId, ...result });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/testing] commit failed');
    return res.status(500).json({ error: 'TestCommitFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/start   — PROPOSED → RUNNING
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/start', requireOperator, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const test = await startTest(wsId, req.params.id);
    return res.json({ workspaceId: wsId, test });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'TestNotFound', message: err.message });
    if (err.code === 'TEST_CONFLICT') return res.status(409).json({ error: 'TestConflict', message: err.message });
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] start failed');
    return res.status(500).json({ error: 'TestStartFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/metrics   — record variant counts
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/metrics', requireOperator, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const rows = Array.isArray(req.body?.variants) ? req.body.variants : [];
  if (rows.length === 0) return res.status(400).json({ error: 'BadRequest', message: 'variants[] is required' });

  try {
    const result = await recordVariantMetrics(wsId, req.params.id, rows);
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'TestNotFound', message: err.message });
    if (err.code === 'TEST_CONFLICT') return res.status(409).json({ error: 'TestConflict', message: err.message });
    if (err.code === 'INVALID_TEST_METRICS') return res.status(400).json({ error: 'InvalidTestMetrics', message: err.message });
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] metrics failed');
    return res.status(500).json({ error: 'TestMetricsFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/conclude   — THE LOOP
// Reads the winner honestly, writes the outcome to memory, and (when
// confident + governance-valid) emits a PROPOSED REFRESH/SCALE Decision
// that the user confirms through the existing execute path. Never
// auto-executes.
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/conclude', requireOperator, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const result = await concludeTest(wsId, req.params.id);
    logger.info({ wsId, testId: req.params.id, verdict: result.verdict, decisionId: result.decisionId }, '[lumi/testing] concluded');
    return res.json({ workspaceId: wsId, ...result });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'TestNotFound', message: err.message });
    if (err.code === 'TEST_CONFLICT') return res.status(409).json({ error: 'TestConflict', message: err.message });
    if (err.code === 'INVALID_TEST_METRICS') return res.status(400).json({ error: 'InvalidTestMetrics', message: err.message });
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] conclude failed');
    return res.status(500).json({ error: 'TestConcludeFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/tests/:id/promote-to-holdout   — Phase-7C bridge
// Promote a CONCLUDED A/B test into a DESIGNED holdout (causal lift). Gates, in
// order: operator (BUYER+STRATEGIST) → measurement tier → STRATEGIST → Enterprise.
// A BUYER may SEE the affordance (awareness) but only a STRATEGIST on an
// Enterprise workspace may design the holdout — this is the enforcement backstop
// behind the same split the UI presents.
// ─────────────────────────────────────────────────────────────
testingRouter.post('/tests/:id/promote-to-holdout', requireOperator, requireMeasurementTier, requireStrategist, async (req, res) => {
  const wsId = req.measurementWorkspaceId; // resolved by the tier gate
  // Holdout promotion is an Enterprise capability — stricter than the base
  // measurement gate (which clears AGENCY). One consistent tier-lock shape.
  if (req.measurementTier !== 'ENTERPRISE') {
    return res.status(403).json({ error: 'TierGated', message: 'Holdout testing requires Enterprise tier — upgrade in Settings.' });
  }

  const { dailyEligible, mde, channel } = req.body ?? {};
  if (!Number.isInteger(dailyEligible) || dailyEligible <= 0) {
    return res.status(422).json({ error: 'BadPromote', message: 'dailyEligible must be a positive integer.' });
  }
  if (mde != null && (typeof mde !== 'number' || mde <= 0 || mde >= 1)) {
    return res.status(422).json({ error: 'BadPromote', message: 'mde, if supplied, must be between 0 and 1.' });
  }
  if (channel != null && (typeof channel !== 'string' || !channel.trim())) {
    return res.status(422).json({ error: 'BadPromote', message: 'channel, if supplied, must be a non-empty string.' });
  }

  try {
    const incrementalityTest = await promoteTestToHoldout(wsId, req.params.id, { dailyEligible, mde, channel });
    logger.info({ wsId, testId: req.params.id, holdoutId: incrementalityTest.id }, '[lumi/testing] promoted to holdout');
    return res.status(201).json({ workspaceId: wsId, incrementalityTest });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'TestNotFound', message: err.message });
    if (/not CONCLUDED/i.test(err.message)) return res.status(409).json({ error: 'TestNotConcluded', message: err.message });
    if (/control variant|zero clicks|baseline conversion/i.test(err.message)) return res.status(409).json({ error: 'NoBaseline', message: err.message });
    if (/baselineCvr|mde|dailyEligible|required/i.test(err.message)) return res.status(422).json({ error: 'BadPromote', message: err.message });
    logger.error({ err: err.message, wsId, testId: req.params.id }, '[lumi/testing] promote-to-holdout failed');
    return res.status(500).json({ error: 'PromoteFailed', message: 'Request failed' });
  }
});
