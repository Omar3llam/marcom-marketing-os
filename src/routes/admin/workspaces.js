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
import { listConnections, deleteWorkspaceCredentials, withWorkspaceCredentialTransaction } from '../../services/connectors/credentialStore.js';
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

// The counts an operator is shown before confirming, and the `before` snapshot
// the audit row keeps afterwards. Read in ONE query with the name, because after
// the delete none of it is recoverable — the audit row is the only surviving
// record of how much was destroyed.
//
// SC-2 dropped `actions` from this list with the model behind it. It was the
// second and last production reader of the legacy Action table — a `_count`
// relation traversal rather than a `prisma.action` call, which is why a
// delegate-level search does not find it. Every other key here counts a
// population something still writes.
const DELETE_COUNTS = {
  users: true, decisions: true, accounts: true, campaignEntities: true,
  adSets: true, ads: true, metricSnapshots: true,
};

// DELETE /api/admin/workspaces/:id — destroy a workspace and everything in it.
//
// This is the most destructive route in the product and it is IRREVERSIBLE:
// 59 models cascade from workspaces, so one statement removes every campaign,
// snapshot, decision, outcome and membership. There is no undo and no soft
// delete. Four guards stand in front of it:
//
//   1. TYPED CONFIRMATION — the body must carry `confirmName` matching the
//      workspace's name EXACTLY. A misclicked row cannot be deleted, because
//      confirming requires reading the name of the thing you are destroying.
//      (The demo route's two-click confirm is fine for a throwaway seed; it is
//      not enough for a customer account.)
//   2. SELF-PROTECTION — an admin may not delete the workspace they are
//      operating from. It would revoke their own session's workspace mid-flight
//      and leave the panel talking about a row that no longer exists.
//   3. LAST-ADMIN — refuses while another ADMIN still belongs to the workspace,
//      unless `force` is set. Mirrors the users route's last-STRATEGIST guard.
//   4. AUDIT — DELETE_WORKSPACE, with the full counts, written after the fact.
//      admin_audit_logs has no FK to workspaces precisely so this row survives.
//
// Purge and cascade share a Prisma transaction and OAuth's workspace row lock.
workspacesRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const confirmName = typeof req.body?.confirmName === 'string' ? req.body.confirmName : null;
  const force = req.body?.force === true;

  try {
    const result = await withWorkspaceCredentialTransaction(prisma, id, async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id },
        select: {
          id: true, name: true, plan: true, createdAt: true,
          users: { where: { role: 'ADMIN' }, select: { id: true, email: true } },
          _count: { select: DELETE_COUNTS },
        },
      });
      if (!ws) return { status: 404, body: { error: 'Workspace not found' } };

      // GUARD 2 — before the name check, so an operator who typed their own
      // workspace's name correctly still gets the real reason for the refusal.
      const actor = await tx.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
      if ((req.workspaceId && req.workspaceId.toLowerCase() === ws.id) || actor?.workspaceId === ws.id) {
        return { status: 409, body: {
          error: 'Refusing to delete the workspace you are signed in to. Switch workspaces first.',
        } };
      }

      // GUARD 1 — exact match, no trimming or case-folding. A near-miss is a
      // near-miss; silently accepting one would defeat the point of typing it.
      if (confirmName !== ws.name) {
        return { status: 400, body: {
          error: 'Confirmation does not match. Send confirmName exactly equal to the workspace name.',
          expectedName: ws.name,
        } };
      }

      // GUARD 3 — another operator's account. Overridable, never silent.
      const otherAdmins = ws.users.filter((u) => u.id !== req.userId);
      if (otherAdmins.length > 0 && !force) {
        return { status: 409, body: {
          error: `This workspace has ${otherAdmins.length} other ADMIN member${otherAdmins.length === 1 ? '' : 's'}. Re-send with force: true to delete anyway.`,
          admins: otherAdmins.map((u) => u.email),
        } };
      }

      // Counts are captured BEFORE anything is destroyed — after the cascade
      // there is nothing left to count, and an audit row that could not say what
      // it removed would be a record of nothing.
      const before = { name: ws.name, plan: ws.plan ?? 'FREE', createdAt: ws.createdAt, counts: { ...ws._count } };

      // Credentials first. They do NOT cascade (no FK — raw-SQL table), and if
      // this throws we abort with the workspace still intact, rather than leaving
      // live OAuth tokens orphaned behind a deleted account.
      const credentialsDeleted = await deleteWorkspaceCredentials(ws.id, tx);
      await tx.workspace.delete({ where: { id: ws.id } });
      return { ws, before, credentialsDeleted };
    });
    if (result.status) return res.status(result.status).json(result.body);
    const { ws, before, credentialsDeleted } = result;
    logger.warn({ workspaceId: ws.id, name: ws.name, credentialsDeleted, counts: before.counts, actorUid: req.userId },
      '[admin/workspaces] DELETED workspace');

    // After the delete, for the same reason the demo route does it: a row
    // written first would permanently assert a deletion that a failed statement
    // never performed. `after` is null — there is no after.
    await recordAdminAction({
      actorUid: req.userId,
      actorEmail: req.user?.email,
      type: 'DELETE_WORKSPACE',
      targetType: 'WORKSPACE',
      targetId: ws.id,
      workspaceId: ws.id,
      before: { ...before, credentialsDeleted, forced: force },
    });

    return res.json({ deleted: true, workspaceId: ws.id, name: ws.name, counts: before.counts, credentialsDeleted });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Workspace not found' });
    logger.error({ err: err.message, id }, '[admin/workspaces] delete failed');
    return res.status(500).json({ error: 'Failed to delete workspace' });
  }
});
