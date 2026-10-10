// ============================================================
// MARCOM / Admin — Demo workspace management
//   POST   /api/admin/demo/seed            — mint a fresh demo workspace
//   DELETE /api/admin/demo/:workspaceId    — tear down a demo workspace
//
// ADMIN-only (gated at the mount). The seeder reuses the canonical
// seedDemoWorkspace() (the apparel "Maison Salam" 9-phase graph) with a UNIQUE
// key per call so demos never collide. DELETE temporarily fails closed because
// mutable names cannot establish immutable demo identity. Errors return { error }.
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

    // PO 2026-10-10: no immutable demo designation exists. Keep ADMIN authority
    // and missing-workspace 404; do not purge, delete or audit a success.
    return res.status(409).json({
      error: 'DemoDeletionUnavailable',
      message: 'Demo deletion is unavailable until immutable demo identity is established.',
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[admin/demo] delete failed');
    return res.status(500).json({ error: 'Failed to delete demo workspace' });
  }
});
