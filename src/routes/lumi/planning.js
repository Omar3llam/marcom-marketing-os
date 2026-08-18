// ============================================================
// MARCOM / Lumi — Planning OS (scenario · economics · goals · plans)
// POST   /api/lumi/scenario           — what-if ranges + assumptions (no writes)
// GET/PUT /api/lumi/economics         — read assessment (inputs + current CAC +
//                                       computed sustainability) / upsert inputs
// GET/POST /api/lumi/goals            — list / create a NorthStarGoal
// GET/POST /api/lumi/plans            — list / build a Plan
// GET    /api/lumi/plans/:id          — plan + live tracking
// POST   /api/lumi/plans/:id/promote  — promote mix → REALLOCATE Decisions (P3 loop)
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { runScenario } from '../../services/scenario-engine/ScenarioService.js';
import { getEconomicsAssessment, setEconomics } from '../../services/unit-economics/EconomicsService.js';
import { buildPlan, listPlans, getPlan, promotePlanMix } from '../../services/planning/PlanService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { requirePlan }        from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

// Planning (PLAN surface) is STRATEGIST-only — not in a BUYER/CLIENT's visibleStates.
const requireStrategist = requireCollabRole(WORKSPACE_ROLE.STRATEGIST);

export const planningRouter = Router();

// ── Plan gates ───────────────────────────────────────────────
// economics · goals · plans render on the Intelligence → Growth Strategy
// surface (GROWTH). /scenario is the what-if planner on the Measurement surface
// (PRO). Mixed tiers within one router → targeted path gates, not a blanket use.
planningRouter.use(['/economics', '/goals', '/plans'], requirePlan('GROWTH'));
planningRouter.use('/scenario', requirePlan('PRO'));

// Resolve workspaceId — mirrors lumi/memory.js. Never fabricate a synthetic
// id (workspaceId columns are @db.Uuid).
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/planning] workspaceId fallback failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/scenario — what-if projection (ranges, ephemeral)
// body: { change: { type, shifts?|newTotalBudgetMinor?|deltaPct? } }
// ─────────────────────────────────────────────────────────────
// R11 (I63): read-only projection, but planning is a strategist surface and a
// scenario run is real compute over the account's economics. The commit-side
// writes are already STRATEGIST; the preview should not be broader than what
// it previews.
planningRouter.post('/scenario', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const scenario = await runScenario(wsId, { change: req.body?.change });
    if (!scenario) return res.json({ workspaceId: wsId, scenario: null, message: 'No channel data to project yet.' });
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), scenario });
  } catch (err) {
    const bad = /change\.type|baseline|economics|shifts/i.test(err.message);
    if (bad) return res.status(400).json({ error: 'BadScenario', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/planning] scenario failed');
    return res.status(500).json({ error: 'ScenarioUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/economics — econ row + sustainability of current CAC
// PUT /api/lumi/economics — upsert
// ─────────────────────────────────────────────────────────────
planningRouter.get('/economics', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.json({ workspaceId: null, economics: null, isDefault: true, currentCac: null, assessment: null, reason: 'NOT_CONFIGURED' });
  try {
    const assessment = await getEconomicsAssessment(wsId);
    return res.json({ workspaceId: wsId, ...assessment });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/planning] economics get failed');
    return res.status(500).json({ error: 'EconomicsUnavailable', message: 'Request failed' });
  }
});

planningRouter.put('/economics', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const economics = await setEconomics(wsId, req.body ?? {});
    return res.json({ workspaceId: wsId, economics });
  } catch (err) {
    const bad = /aovMinor|grossMarginPct|required/i.test(err.message);
    if (bad) return res.status(400).json({ error: 'BadEconomics', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/planning] economics put failed');
    return res.status(500).json({ error: 'EconomicsSaveFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET  /api/lumi/goals — list north-star goals
// POST /api/lumi/goals — create one
// ─────────────────────────────────────────────────────────────
planningRouter.get('/goals', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.json({ workspaceId: null, goals: [] });
  try {
    const goals = await prisma.northStarGoal.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return res.json({ workspaceId: wsId, goals });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/planning] goals list failed');
    return res.status(500).json({ error: 'GoalsUnavailable', message: 'Request failed' });
  }
});

planningRouter.post('/goals', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  const b = req.body ?? {};
  if (!b.metric || !b.comparator || typeof b.targetValue !== 'number' || !b.periodStart || !b.periodEnd) {
    return res.status(400).json({ error: 'BadGoal', message: 'metric, comparator, targetValue, periodStart, periodEnd required.' });
  }
  try {
    const goal = await prisma.northStarGoal.create({
      data: {
        workspaceId: wsId,
        name: b.name ?? `${b.metric} ${b.comparator} ${b.targetValue}`,
        metric: b.metric, comparator: b.comparator, targetValue: b.targetValue,
        spendCeilingMinor: typeof b.spendCeilingMinor === 'number' ? b.spendCeilingMinor : null,
        currency: b.currency ?? 'USD',
        periodStart: new Date(b.periodStart), periodEnd: new Date(b.periodEnd),
        planId: b.planId ?? null,
      },
    });
    return res.status(201).json({ workspaceId: wsId, goal });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/planning] goal create failed');
    return res.status(500).json({ error: 'GoalCreateFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET  /api/lumi/plans — list
// POST /api/lumi/plans — build (assemble budget + mix + tests + projections)
// ─────────────────────────────────────────────────────────────
planningRouter.get('/plans', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.json({ workspaceId: null, plans: [] });
  try {
    return res.json({ workspaceId: wsId, plans: await listPlans(wsId) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/planning] plans list failed');
    return res.status(500).json({ error: 'PlansUnavailable', message: 'Request failed' });
  }
});

planningRouter.post('/plans', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  const b = req.body ?? {};
  if (typeof b.totalBudgetMinor !== 'number' || !b.periodStart || !b.periodEnd) {
    return res.status(400).json({ error: 'BadPlan', message: 'totalBudgetMinor, periodStart, periodEnd required.' });
  }
  try {
    const plan = await buildPlan(wsId, {
      name: b.name, periodStart: b.periodStart, periodEnd: b.periodEnd,
      totalBudgetMinor: b.totalBudgetMinor, change: b.change, goal: b.goal,
    });
    return res.status(201).json({ workspaceId: wsId, plan });
  } catch (err) {
    const bad = /totalBudgetMinor|periodEnd|required/i.test(err.message);
    if (bad) return res.status(400).json({ error: 'BadPlan', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/planning] plan build failed');
    return res.status(500).json({ error: 'PlanBuildFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/plans/:id — plan + live tracking
// ─────────────────────────────────────────────────────────────
planningRouter.get('/plans/:id', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const plan = await getPlan(wsId, req.params.id);
    if (!plan) return res.status(404).json({ error: 'PlanNotFound' });
    return res.json({ workspaceId: wsId, plan });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/planning] plan get failed');
    return res.status(500).json({ error: 'PlanUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/plans/:id/promote — mix → PROPOSED REALLOCATE Decisions
// Rides the existing Phase-3 confirm→execute governance. No new exec code.
// ─────────────────────────────────────────────────────────────
planningRouter.post('/plans/:id/promote', requireStrategist, async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });
  try {
    const result = await promotePlanMix(wsId, req.params.id);
    logger.info({ wsId, ...result }, '[lumi/planning] plan mix promoted');
    return res.status(201).json({ workspaceId: wsId, ...result });
  } catch (err) {
    if (err.code === 'ApprovalRequired') return res.status(409).json({ error: 'ApprovalRequired', message: err.message, planId: req.params.id, approvalState: err.approvalState ?? null });
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'PlanNotFound', message: err.message });
    if (/no channels/i.test(err.message)) return res.status(409).json({ error: 'NothingToPromote', message: err.message });
    logger.error({ err: err.message, wsId }, '[lumi/planning] promote failed');
    return res.status(500).json({ error: 'PromoteFailed', message: 'Request failed' });
  }
});
