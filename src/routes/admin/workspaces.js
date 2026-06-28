// ============================================================
// MARCOM / Admin — Workspaces
//   GET /api/admin/workspaces — every workspace with user + decision counts.
//
// ADMIN-only (gated at the mount). Cross-workspace by design — this is the ONE
// place the workspace-isolation rule is intentionally lifted, for the operator.
// Capped at 100 rows (newest first). Errors return { error: message } only.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export const workspacesRouter = Router();

const MAX_WORKSPACES = Number(process.env.ADMIN_MAX_WORKSPACES || 100);

// A workspace is a throwaway demo iff its name carries the "Demo —" sentinel
// that seedDemoWorkspace stamps (and the delete route enforces). Keep this in
// sync with src/routes/admin/demo.js DEMO_NAME_PREFIX.
const DEMO_NAME_PREFIX = 'Demo —';

workspacesRouter.get('/', async (_req, res) => {
  try {
    const rows = await prisma.workspace.findMany({
      take: MAX_WORKSPACES,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        currency: true,
        createdAt: true,
        _count: { select: { users: true, decisions: true } },
      },
    });

    const workspaces = rows.map((w) => ({
      id: w.id,
      name: w.name,
      currency: w.currency,
      createdAt: w.createdAt,
      userCount: w._count.users,
      decisionCount: w._count.decisions,
      isDemo: w.name.startsWith(DEMO_NAME_PREFIX),
    }));

    res.json({ workspaces, total: workspaces.length });
  } catch (err) {
    logger.error({ err: err.message }, '[admin/workspaces] list failed');
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});
