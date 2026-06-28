// ============================================================
// MARCOM / Admin — Users
//   GET /api/admin/users — every user with system role, collab role, workspace.
//
// ADMIN-only (gated at the mount). Cross-workspace by design. Capped at 200
// rows (newest first). Errors return { error: message } only — never a trace.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

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
