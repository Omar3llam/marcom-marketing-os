// ============================================================
// MARCOM / Admin — Users
//   GET   /api/admin/users?q=&role=&limit=&offset=
//         — a searchable, paginated page of users with system role,
//           collab role and workspace.
//   PATCH /api/admin/users/:id/role  — set a user's collabRole.
//
// ADMIN-only (gated at the mount). Cross-workspace by design. Errors return
// { error: message } only — never a trace.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { WORKSPACE_ROLES, canDowngradeStrategist } from '../../lib/workspaceGuards.js';
import { recordAdminAction } from '../../lib/adminAudit.js';
import { parseLimit, parseOffset, parseSearch, parseEnum } from './pagination.js';

export const usersRouter = Router();

const MAX_USERS = Number(process.env.ADMIN_MAX_USERS || 200);
const DEFAULT_LIMIT = 25;

// The system-role axis (UserRole), NOT collabRole — this mirrors the filter the
// panel already offered. A Prisma enum, so an unrecognised value would throw a
// validation error rather than match nothing; parseEnum drops it instead.
const SYSTEM_ROLES = ['ADMIN', 'VIEWER'];

usersRouter.get('/', async (req, res) => {
  const limit = parseLimit(req.query.limit, { def: DEFAULT_LIMIT, max: MAX_USERS });
  const offset = parseOffset(req.query.offset);
  const q = parseSearch(req.query.q);
  const role = parseEnum(req.query.role, SYSTEM_ROLES);

  const where = {
    ...(q ? { email: { contains: q, mode: 'insensitive' } } : {}),
    ...(role ? { role } : {}),
  };

  try {
    // A real count under the same where clause. The role filter used to run in
    // the browser over the loaded page, so filtering to ADMIN when the only
    // admin sat past the cap produced "No users match" — a false negative
    // stated as a fact. Server-side, the count and the page agree.
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          collabRole: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } },
        },
      }),
    ]);

    const users = rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      collabRole: u.collabRole,
      workspaceId: u.workspace?.id ?? null,
      workspaceName: u.workspace?.name ?? null,
      createdAt: u.createdAt,
    }));

    res.json({ users, total, limit, offset });
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
