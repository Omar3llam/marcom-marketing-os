// ============================================================
// requirePlan — feature-gating entitlement gate (server-side hard paywall)
// ============================================================
// The plan-tier sibling of requireCollabRole / requireMeasurementTier. Gates a
// route to a MINIMUM workspace plan on the FREE < GROWTH < PRO hierarchy. This
// is the server complement to the client PlanGate (usePlan) — the paywall a
// direct API call must not slip past.
//
// Reads Workspace.plan FRESH per gated request (a separate findUnique), NOT
// pre-fetched globally in firebaseAuth. Rationale: firebaseAuth runs on every
// authenticated request, so pre-fetching would add a DB read to the ~95% of
// requests that hit no gate; the read here is paid only on the handful of gated
// routes. Reading fresh also means an admin plan change takes effect immediately
// (no cache-TTL lag on the paywall). requirePlan runs once per request, so
// there is no intra-request duplicate read to optimize away.
//
// Compose AFTER requireAuth and (by convention) BEFORE requireCollabRole:
//   who are you (auth) → what can this workspace access (plan) → what may this
//   seat do (role).
//
// Env override PLAN_OVERRIDE for local/dev + tests (mirrors
// MEASUREMENT_TIER_OVERRIDE / COLLAB_ROLE_OVERRIDE). Set it to the effective
// plan; the normal hierarchy check still applies (PLAN_OVERRIDE=FREE will still
// 403 a GROWTH route, PLAN_OVERRIDE=PRO unlocks everything).
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

export const PLAN_RANK = { FREE: 0, GROWTH: 1, PRO: 2 };
const rank = (p) => PLAN_RANK[p] ?? 0; // unknown/missing plan floors to FREE

// Resolve workspaceId — mirrors requireMeasurementTier. firebaseAuthMiddleware
// normally sets req.workspaceId; fall back to a direct uid lookup for a
// transient miss. Never fabricate a synthetic id (workspaceId is @db.Uuid).
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[requirePlan] workspaceId fallback failed');
    return null;
  }
}

function deny(res, required, current) {
  return res.status(403).json({
    error: 'PLAN_REQUIRED',
    required,
    current,
    message: `This feature requires the ${required} plan.`,
  });
}

/**
 * Gate a route to a minimum workspace plan.
 * @param {'FREE'|'GROWTH'|'PRO'} minimumPlan
 */
export function requirePlan(minimumPlan) {
  return async function planGate(req, res, next) {
    // Dev/local/test escape hatch — set the effective plan without a DB read.
    const override = process.env.PLAN_OVERRIDE;
    if (override) {
      req.workspacePlan = override;
      return rank(override) >= rank(minimumPlan) ? next() : deny(res, minimumPlan, override);
    }

    const wsId = await resolveWorkspaceId(req);
    if (!wsId) return res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' });

    let plan;
    try {
      const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { plan: true } });
      plan = ws?.plan ?? 'FREE'; // missing/null column ⇒ FREE (safe default)
    } catch (err) {
      // Fail honest, not silently open: an infra error is a 500, not a free pass.
      logger.error({ err: err.message, workspaceId: wsId }, '[requirePlan] plan lookup failed');
      return res.status(500).json({ error: 'Internal server error' });
    }

    req.workspacePlan = plan; // available downstream
    return rank(plan) >= rank(minimumPlan) ? next() : deny(res, minimumPlan, plan);
  };
}
