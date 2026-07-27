// ============================================================
// MARCOM / Admin — Demo workspace management
//   POST   /api/admin/demo/seed            — mint a fresh demo workspace
//   DELETE /api/admin/demo/:workspaceId    — tear down a demo workspace
//
// ADMIN-only (gated at the mount). The seeder reuses the canonical
// seedDemoWorkspace() (the apparel "Maison Salam" 9-phase graph) with a UNIQUE
// key per call so demos never collide. DELETE refuses any workspace whose name
// does NOT start with the "Demo —" sentinel — a hard guard so this route can
// never tear down a real customer workspace. Errors return { error } only.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { seedDemoWorkspace } from '../../../prisma/seed.js';
import { recordAdminAction } from '../../lib/adminAudit.js';

export const demoRouter = Router();

// The sentinel every demo workspace name begins with. Keep in sync with
// src/routes/admin/workspaces.js DEMO_NAME_PREFIX.
const DEMO_NAME_PREFIX = 'Demo —';

// ── POST /seed — create a fresh, independent demo workspace ──
demoRouter.post('/seed', async (req, res) => {
  // Unique key → seedDemoWorkspace mints a brand-new graph (not an upsert over
  // the canonical apparel seed). Date.now()+random survives same-ms double-fire.
  const stamp = new Date();
  const key = `demo-${stamp.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `${DEMO_NAME_PREFIX} Maison Salam · ${stamp.toISOString()}`;

  try {
    const { workspaceId } = await seedDemoWorkspace(prisma, { key, name });
    logger.info({ workspaceId, name }, '[admin/demo] seeded demo workspace');

    // Logged after the seed: the target id does not exist until then, and a row
    // naming a workspace that was never created would be a false record.
    await recordAdminAction({
      actorUid: req.userId,
      actorEmail: req.user?.email,
      type: 'SEED_DEMO',
      targetType: 'WORKSPACE',
      targetId: workspaceId,
      workspaceId,
      after: { name },
    });

    return res.status(201).json({ workspaceId, name, message: 'Demo workspace created' });
  } catch (err) {
    logger.error({ err: err.message, key }, '[admin/demo] seed failed');
    return res.status(500).json({ error: 'Failed to seed demo workspace' });
  }
});

// ── DELETE /:workspaceId — tear down a demo workspace ────────
demoRouter.delete('/:workspaceId', async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // HARD SAFETY GUARD: never delete a non-demo workspace.
    if (!ws.name.startsWith(DEMO_NAME_PREFIX)) {
      logger.warn({ workspaceId, name: ws.name }, '[admin/demo] refused delete of non-demo workspace');
      return res.status(403).json({ error: 'Refusing to delete a non-demo workspace' });
    }

    // Relations cascade on workspace delete (every workspace-scoped model
    // carries onDelete: Cascade).
    await prisma.workspace.delete({ where: { id: workspaceId } });
    logger.info({ workspaceId, name: ws.name }, '[admin/demo] deleted demo workspace');

    // Recorded AFTER the delete, not before it. The audit row survives either
    // way — that is what the missing foreign key buys — so ordering is purely a
    // question of truthfulness, and a row written first would permanently
    // assert a deletion that a failed DELETE never performed. The cascade is a
    // single atomic statement, so there is no partial-deletion state that a
    // write-ahead row would be needed to catch. `before` is read from the
    // sentinel guard above, so nothing is lost by waiting.
    await recordAdminAction({
      actorUid: req.userId,
      actorEmail: req.user?.email,
      type: 'DELETE_DEMO',
      targetType: 'WORKSPACE',
      targetId: workspaceId,
      workspaceId,
      before: { name: ws.name },
    });

    return res.json({ deleted: true, workspaceId });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[admin/demo] delete failed');
    return res.status(500).json({ error: 'Failed to delete demo workspace' });
  }
});
