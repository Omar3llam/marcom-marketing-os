// ============================================================
// MARCOM / Admin — Users
//   GET   /api/admin/users           — every user with system role, collab role, workspace.
//   PATCH /api/admin/users/:id/role  — set a user's collabRole.
//
// ADMIN-only (gated at the mount). Cross-workspace by design. Capped at 200
// rows (newest first). Errors return { error: message } only — never a trace.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { WORKSPACE_ROLES, canDowngradeStrategist } from '../../lib/workspaceGuards.js';
import { recordAdminAction } from '../../lib/adminAudit.js';

export const usersRouter = Router();

const MAX_USERS = Number(process.env.ADMIN_MAX_USERS || 200);

usersRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.user.findMany({
      take: MAX_USERS,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        collabRole: true,
        createdAt: true,
        workspace: { select: { id: true, name: true } },
      },
    });

    const users = rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      collabRole: u.collabRole,
      workspaceId: u.workspace?.id ?? null,
      workspaceName: u.workspace?.name ?? null,
      createdAt: u.createdAt,
    }));

    res.json({ users, total: users.length });
  } catch (err) {
    logger.error({ err: err.message }, '[admin/users] list failed');
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// PATCH /:id/role — set a user's collabRole. Body: { collabRole, force? }
//
// The same last-strategist rule the in-workspace Team tab enforces
// (workspaceGuards), with one difference: an admin MAY override it with
// `force: true`, because an admin can also repair the workspace afterwards.
// The override is explicit and per-request — never a default.
usersRouter.patch('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { collabRole = null, force = false } = req.body ?? {};

  // null is a legitimate value: roleScope reads it as STRATEGIST.
  if (collabRole !== null && !WORKSPACE_ROLES.includes(collabRole)) {
    return res.status(400).json({ error: `Invalid role. Expected one of: ${WORKSPACE_ROLES.join(', ')}, or null` });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, clerkId: true, workspaceId: true, collabRole: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // req.userId is the FIREBASE uid, which lives on User.clerkId — comparing it
    // to User.id (a uuid) would never match, so the guard would be decorative.
    if (user.clerkId && user.clerkId === req.userId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (!force) {
      const check = await canDowngradeStrategist(user.workspaceId, user.id, user.collabRole, collabRole);
      if (!check.allowed) {
        // 409, not 400: the request is well-formed — it conflicts with the
        // workspace's current state, and the same request succeeds with force.
        return res.status(409).json({
          error: check.reason,
          message: 'This is the last strategist in the workspace. Downgrading leaves nobody who can manage roles or execute.',
        });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { collabRole },
      select: { id: true, email: true, collabRole: true },
    });
    logger.info({ id, collabRole, force, by: req.userId }, '[admin/users] collabRole changed');

    // `forced` rides in the payload deliberately: a forced downgrade is the one
    // change here that can leave a workspace with nobody able to manage it, and
    // an audit row that didn't distinguish it would miss the reason it exists.
    await recordAdminAction({
      actorUid: req.userId,
      actorEmail: req.user?.email,
      type: 'CHANGE_ROLE',
      targetType: 'USER',
      targetId: user.id,
      workspaceId: user.workspaceId,
      before: { collabRole: user.collabRole ?? null },
      after: { collabRole: collabRole ?? null, forced: Boolean(force) },
    });

    return res.json({ user: updated });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    logger.error({ err: err.message, id }, '[admin/users] role update failed');
    return res.status(500).json({ error: 'Failed to update role' });
  }
});
