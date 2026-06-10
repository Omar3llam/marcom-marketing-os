// ============================================================
// MARCOM / Lumi — Portfolio + capital allocation
// GET  /api/lumi/portfolio                  — portfolio view (JWT)
// POST /api/lumi/portfolio/allocate         — scenario preview (no writes)
// POST /api/lumi/portfolio/allocate/commit  — persist plan + REALLOCATE Decisions
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getPortfolio }       from '../../services/portfolio/PortfolioService.js';
import { getBlendedTruth }    from '../../services/blended-truth/BlendedTruthService.js';
import { previewAllocation, commitAllocation } from '../../services/allocation-engine/AllocationService.js';
import { GOAL_TYPE }          from '../../services/allocation-engine/allocationEngine.js';

export const portfolioRouter = Router();

// Resolve workspaceId — mirrors lumi/feed.js. firebaseAuthMiddleware normally
// sets req.workspaceId, but a transient lookup miss can leave it null. Fall
// back to a direct lookup on the Firebase uid (stored in clerkId). Never
// fabricate a synthetic id (workspaceId columns are @db.Uuid).
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/portfolio] workspaceId fallback failed');
    return null;
  }
}

// Parse + validate the allocation request body (shared by preview/commit).
function parseAllocationBody(body = {}) {
  const totalBudgetMinor = Number(body.totalBudgetMinor);
  if (!Number.isFinite(totalBudgetMinor) || totalBudgetMinor <= 0) {
    return { error: 'totalBudgetMinor must be a positive integer (minor units)' };
  }
  const type = body.goal?.type ?? GOAL_TYPE.GROWTH_CEILING;
  if (type !== GOAL_TYPE.GROWTH_CEILING) {
    return { error: `unsupported goal type "${type}" (only GROWTH_CEILING is supported)` };
  }
  const value = body.goal?.value;
  return { totalBudgetMinor, goal: { type, value: typeof value === 'number' ? value : null } };
}

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/portfolio
// ─────────────────────────────────────────────────────────────
portfolioRouter.get('/portfolio', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) {
    return res.json({ workspaceId: null, generatedAt: new Date().toISOString(), totals: null, pacing: null, channels: [] });
  }
  try {
    const view = await getPortfolio(wsId);
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...view });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] failed');
    return res.status(500).json({ error: 'PortfolioUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/lumi/blended — platform-claimed vs reconciled "blended truth".
// Surfaces the "don't trust platform-reported performance" thesis the engine
// already enforces. Read-only; workspace-scoped. Returns { channels, portfolio }
// (BlendedTruthSchema). Empty (no connected channels) → empty arrays, not a fake.
// ─────────────────────────────────────────────────────────────
portfolioRouter.get('/blended', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) {
    return res.json({
      workspaceId: null, generatedAt: new Date().toISOString(),
      channels: [], portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 0, platformRoas: 0, blendedRoas: 0, reconciledCount: 0, unverifiedCount: 0 },
    });
  }
  try {
    const truth = await getBlendedTruth(wsId);
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...truth });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] blended truth failed');
    return res.status(500).json({ error: 'BlendedTruthUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/portfolio/allocate   — scenario preview (no writes)
// ─────────────────────────────────────────────────────────────
portfolioRouter.post('/portfolio/allocate', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const parsed = parseAllocationBody(req.body);
  if (parsed.error) return res.status(400).json({ error: 'BadRequest', message: parsed.error });

  try {
    const plan = await previewAllocation(wsId, parsed);
    if (!plan) return res.json({ workspaceId: wsId, plan: null, message: 'No connected channels to allocate.' });
    return res.json({ workspaceId: wsId, plan });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] allocate preview failed');
    return res.status(500).json({ error: 'AllocationFailed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/portfolio/allocate/commit
// Persists the AllocationPlan + PROPOSED REALLOCATE Decisions. The
// moves still require human confirm → they flow through the existing
// /api/execute/meta REALLOCATE_BUDGET governance. Never auto-executes.
// ─────────────────────────────────────────────────────────────
portfolioRouter.post('/portfolio/allocate/commit', async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const parsed = parseAllocationBody(req.body);
  if (parsed.error) return res.status(400).json({ error: 'BadRequest', message: parsed.error });

  try {
    const { planId, decisionsCreated, plan } = await commitAllocation(wsId, parsed);
    logger.info({ wsId, planId, decisionsCreated }, '[lumi/portfolio] allocation committed');
    return res.status(201).json({ workspaceId: wsId, planId, decisionsCreated, plan });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] allocate commit failed');
    return res.status(500).json({ error: 'AllocationCommitFailed', message: err.message });
  }
});
