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
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { requirePlan }        from '../../middleware/requirePlan.js';
import { WORKSPACE_ROLE }     from '../../services/collaboration/roleScope.js';

export const portfolioRouter = Router();

// ── Plan gates (GROWTH) ──────────────────────────────────────
// Blended Truth + capital allocation are the Intelligence (GROWTH) surface.
// NOTE the deliberate asymmetry: GET /portfolio stays FREE — it feeds the
// Overview budget-pacing widget, a FREE surface. Only /blended (Blended Truth
// read) and the /portfolio/allocate* writes are gated. The '/portfolio/allocate'
// prefix matches both allocate + allocate/commit, and NOT the bare /portfolio.
portfolioRouter.use('/blended', requirePlan('GROWTH'));
portfolioRouter.use('/portfolio/allocate', requirePlan('GROWTH'));

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
  return { totalBudgetMinor, totalBudgetCurrency: body.totalBudgetCurrency, goal: { type, value: typeof value === 'number' ? value : null } };
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
    return res.status(500).json({ error: 'PortfolioUnavailable', message: 'Request failed' });
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
    return res.status(500).json({ error: 'BlendedTruthUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/portfolio/allocate   — scenario preview (no writes)
// ─────────────────────────────────────────────────────────────
// R11 (I63): preview only — no writes — but it is the preview of a STRATEGIST
// action (/portfolio/allocate/commit) and exposes the full portfolio economics.
// Matching the two keeps one decision rather than two that can drift.
portfolioRouter.post('/portfolio/allocate', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const parsed = parseAllocationBody(req.body);
  if (parsed.error) return res.status(400).json({ error: 'BadRequest', message: parsed.error });

  try {
    const plan = await previewAllocation(wsId, parsed);
    if (!plan) return res.json({ workspaceId: wsId, plan: null, message: 'No connected channels to allocate.' });
    return res.json({ workspaceId: wsId, plan });
  } catch (err) {
    // B5-01T′ · STOP-3. A refusal that arrives as a generic 500 is fail-closed
    // but illegible — the caller cannot tell "we could not read the evidence you
    // asked us to reason from" apart from "the allocator broke". The refusal is
    // raised by ReconciliationService.incrementalChannels and only on the
    // explicit `basis: 'incremental'` path; every other failure keeps the
    // existing generic code, byte for byte.
    if (err.code === 'ATTRIBUTION_EVIDENCE_UNAVAILABLE') {
      logger.warn({ err: err.message, wsId, reason: err.reason }, '[lumi/portfolio] allocate refused — evidence unavailable');
      return res.status(503).json({
        error: 'AttributionEvidenceUnavailable', code: err.code, reason: err.reason,
        message: 'Incremental allocation was requested, but the measurement evidence could not be read. No plan was produced.',
      });
    }
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] allocate preview failed');
    return res.status(500).json({ error: 'AllocationFailed', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/lumi/portfolio/allocate/commit
// Persists the AllocationPlan + PROPOSED REALLOCATE Decisions. The
// moves still require human confirm → they flow through the existing
// /api/execute/meta REALLOCATE_BUDGET governance. Never auto-executes.
// ─────────────────────────────────────────────────────────────
portfolioRouter.post('/portfolio/allocate/commit', requireCollabRole(WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

  const parsed = parseAllocationBody(req.body);
  if (parsed.error) return res.status(400).json({ error: 'BadRequest', message: parsed.error });

  try {
    const { planId, decisionsCreated, plan } = await commitAllocation(wsId, parsed);
    logger.info({ wsId, planId, decisionsCreated }, '[lumi/portfolio] allocation committed');
    return res.status(201).json({ workspaceId: wsId, planId, decisionsCreated, plan });
  } catch (err) {
    if (err.code === 'AllocationMonetaryUnavailable') {
      return res.status(409).json({ error: err.code, reason: err.reason, monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED' });
    }
    logger.error({ err: err.message, wsId }, '[lumi/portfolio] allocate commit failed');
    return res.status(500).json({ error: 'AllocationCommitFailed', message: 'Request failed' });
  }
});
