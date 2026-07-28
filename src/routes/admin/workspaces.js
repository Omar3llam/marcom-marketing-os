// ============================================================
// MARCOM / Admin — Workspaces
//   GET /api/admin/workspaces?q=&plan=&demo=&limit=&offset=
//     — a searchable, paginated page of workspaces with user + decision counts.
//
// ADMIN-only (gated at the mount). Cross-workspace by design — this is the ONE
// place the workspace-isolation rule is intentionally lifted, for the operator.
// Errors return { error: message } only.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { recordAdminAction } from '../../lib/adminAudit.js';
import { listConnections } from '../../services/connectors/credentialStore.js';
import { parseLimit, parseOffset, parseSearch, parseEnum } from './pagination.js';

export const workspacesRouter = Router();

const MAX_WORKSPACES = Number(process.env.ADMIN_MAX_WORKSPACES || 100);
const DEFAULT_LIMIT = 25;

// A workspace is a throwaway demo iff its name carries the "Demo —" sentinel
// that seedDemoWorkspace stamps (and the delete route enforces). Keep this in
// sync with src/routes/admin/demo.js DEMO_NAME_PREFIX.
const DEMO_NAME_PREFIX = 'Demo —';

// The feature-gating entitlements an admin can assign. There is no billing —
// this is the manual upgrade path (mirrors the measurementTier axis). Declared
// here because the list route filters on the same set the PATCH route writes.
const VALID_PLANS = ['FREE', 'GROWTH', 'PRO'];

// Both `q` and `demo` constrain `name`, so they compose through AND rather than
// object spread: `{ ...{name:{contains}}, ...{name:{startsWith}} }` keeps only
// the last key, which would silently discard the operator's search term.
function buildWorkspaceWhere({ q, plan, demo }) {
  const and = [];
  if (q) and.push({ name: { contains: q, mode: 'insensitive' } });
  if (plan) and.push({ plan });
  if (demo === 'true') and.push({ name: { startsWith: DEMO_NAME_PREFIX } });
  if (demo === 'false') and.push({ NOT: { name: { startsWith: DEMO_NAME_PREFIX } } });
  return and.length ? { AND: and } : {};
}

workspacesRouter.get('/', async (req, res) => {
  const limit = parseLimit(req.query.limit, { def: DEFAULT_LIMIT, max: MAX_WORKSPACES });
  const offset = parseOffset(req.query.offset);
  const q = parseSearch(req.query.q);
  const plan = parseEnum(req.query.plan, VALID_PLANS);
  const demo = req.query.demo;

  const where = buildWorkspaceWhere({ q, plan, demo });

  try {
    // `total` is a real count under the SAME where clause, not rows.length.
    // The page is capped, so reporting its length as the total told an operator
    // with 250 workspaces that they had 100 — a confident, wrong number.
    const [total, rows] = await Promise.all([
      prisma.workspace.count({ where }),
      prisma.workspace.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          currency: true,
          plan: true,
          createdAt: true,
          _count: { select: { users: true, decisions: true } },
        },
      }),
    ]);

    const workspaces = rows.map((w) => ({
      id: w.id,
      name: w.name,
      currency: w.currency,
      plan: w.plan ?? 'FREE',
      createdAt: w.createdAt,
      userCount: w._count.users,
      decisionCount: w._count.decisions,
      isDemo: w.name.startsWith(DEMO_NAME_PREFIX),
    }));

    res.json({ workspaces, total, limit, offset });
  } catch (err) {
    logger.error({ err: err.message }, '[admin/workspaces] list failed');
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// How many members / sweeps the drill-down shows. Both are capped and both
// report the real total alongside, so a busy workspace is never misread as small.
const MAX_DETAIL_USERS = 50;
const MAX_DETAIL_LOOP_RUNS = 5;

// GET /api/admin/workspaces/:id — the operator drill-down.
//
// Three reads, deliberately not one: the workspace row + its members + counts
// come from Prisma; loop runs are a second indexed query; connector state lives
// in marcom_credentials, a RAW-SQL table kept out of the Prisma schema on
// purpose (the Integration model that shadowed it was write-dead and dropped).
//
// This is a DETAIL endpoint, never extra columns on the list: the credential
// read is one round trip per workspace, so folding it into GET / would be an
// N+1 across every row.
workspacesRouter.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        plan: true,
        currency: true,
        createdAt: true,
        // Captured at onboarding and never surfaced anywhere until now.
        spendTier: true,
        objective: true,
        adChannels: true,
        measurementTier: true,
        networkConsent: true,
        users: {
          select: { id: true, email: true, role: true, collabRole: true, createdAt: true },
          take: MAX_DETAIL_USERS,
          orderBy: { createdAt: 'desc' },
        },
        // `users` is capped, so the honest member total has to come from _count.
        _count: {
          select: { users: true, campaignEntities: true, decisions: true, accounts: true, metricSnapshots: true },
        },
      },
    });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const loopRuns = await prisma.loopRun.findMany({
      where: { workspaceId: id },
      orderBy: { startedAt: 'desc' },
      take: MAX_DETAIL_LOOP_RUNS,
      // LoopRun has no `status` column — a sweep's outcome is `closed` plus the
      // queryable `loopHealth` (HEALTHY | DEGRADED | STALLED).
      select: {
        id: true, trigger: true, startedAt: true, finishedAt: true,
        closed: true, loopHealth: true, staleStages: true, summary: true,
      },
    });

    // Connector state degrades on its own. getDb() returns null when
    // DATABASE_URL is absent, and this read crosses into raw SQL — neither may
    // take down a response whose other two thirds are already in hand.
    let connectors;
    try {
      const connections = await listConnections(id);
      connectors = {
        ok: true,
        connections: connections.map((c) => ({
          platform: c.platform,
          isActive: c.isActive,
          accountId: c.accountId,
          // Staleness keys off the last SUCCESS, never last_synced_at alone —
          // nextHealth preserves the prior success across a failed attempt so a
          // broken connector cannot read as fresh.
          lastSyncedAt: c.lastSyncedAt,
          lastSuccessfulSync: c.health?.lastSuccessfulSync ?? null,
          lastAttemptedSync: c.health?.lastAttemptedSync ?? null,
          lastError: c.health?.lastError ?? null,
          // A successful-but-incomplete sync (e.g. an account with more ad-sets
          // than the pagination ceiling). Distinct from lastError: data DID land.
          lastWarning: c.health?.lastWarning ?? null,
          recordsImported: c.health?.recordsImported ?? null,
        })),
      };
    } catch (err) {
      logger.error({ err: err.message, id }, '[admin/workspaces] connector read failed');
      connectors = { ok: false, error: 'Connector status unavailable' };
    }

    return res.json({
      workspace: { ...workspace, isDemo: workspace.name.startsWith(DEMO_NAME_PREFIX) },
      loopRuns,
      connectors,
    });
  } catch (err) {
    logger.error({ err: err.message, id }, '[admin/workspaces] detail failed');
    return res.status(500).json({ error: 'Failed to load workspace' });
  }
});

// PATCH /api/admin/workspaces/:id/plan — set a workspace's entitlement.
// ADMIN-only via the mount (no per-route re-check). Validates the enum before
// touching the row; a missing workspace surfaces as 404, never a silent no-op.
workspacesRouter.patch('/:id/plan', async (req, res) => {
  const { id } = req.params;
  const plan = req.body?.plan;

  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan. Expected one of: ${VALID_PLANS.join(', ')}` });
  }

  try {
    // Read the current plan first — the update's return value is already the
    // NEW state, so an audit row built from it would record before === after.
    const current = await prisma.workspace.findUnique({
      where: { id },
      select: { plan: true },
    });
    if (!current) return res.status(404).json({ error: 'Workspace not found' });

    const workspace = await prisma.workspace.update({
      where: { id },
      data: { plan },
      select: { id: true, name: true, plan: true },
    });

    await recordAdminAction({
      actorUid: req.userId,
      actorEmail: req.user?.email,
      type: 'CHANGE_PLAN',
      targetType: 'WORKSPACE',
      targetId: workspace.id,
      workspaceId: workspace.id,
      before: { plan: current.plan ?? 'FREE' },
      after: { plan: workspace.plan },
    });

    return res.json(workspace);
  } catch (err) {
    // Prisma P2025 = record to update not found.
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    logger.error({ err: err.message, id }, '[admin/workspaces] plan update failed');
    return res.status(500).json({ error: 'Failed to update plan' });
  }
});
