import { prisma }  from '../../lib/prisma.js';
import { logger }  from '../../utils/logger.js';

export function mountContextRoutes(router) {
  router.get('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const email = req.user?.email;
      const user = await prisma.user.findFirst({
        where: { OR: [{ clerkId: userId }, ...(email ? [{ email }] : [])] },
        select: { context: true },
      }).catch(() => null);
      return res.json({ context: user?.context ?? null });
    } catch (err) {
      logger.warn({ err: err.message }, '[campaigns/me/context] read failed');
      return res.json({ context: null });
    }
  });

  router.put('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    const ctx = req.body?.context;
    if (!ctx || typeof ctx !== 'object') return res.status(400).json({ error: 'context object required in body' });

    const email         = req.user?.email || req.body?.email || `${userId}@unknown.local`;
    const workspaceName = req.body?.workspaceName || 'My Workspace';

    try {
      let existing = await prisma.user.findFirst({
        where:  { OR: [{ clerkId: userId }, { email }] },
        select: { id: true, workspaceId: true, clerkId: true, email: true },
      });

      if (!existing) {
        const created = await prisma.user.create({
          data: { clerkId: userId, email, context: ctx, workspace: { create: { name: workspaceName } } },
          select: { id: true, workspaceId: true, context: true },
        });
        logger.info({ firebaseUid: userId, userRowId: created.id, workspaceId: created.workspaceId }, '[campaigns/me/context] created new user + workspace (Firebase)');
        return res.json({ ok: true, user: created, created: true });
      }

      let workspaceId = existing.workspaceId;
      if (!workspaceId) {
        const ws = await prisma.workspace.create({ data: { name: workspaceName } });
        workspaceId = ws.id;
        await prisma.user.update({ where: { id: existing.id }, data: { workspaceId } });
        logger.warn({ userId, repairedWorkspaceId: workspaceId }, '[campaigns/me/context] repaired orphaned user (no workspace)');
      }

      const updated = await prisma.user.update({
        where:  { id: existing.id },
        data:   { context: ctx, clerkId: userId, email },
        select: { id: true, workspaceId: true, context: true },
      });
      logger.info({ firebaseUid: userId, userRowId: updated.id, wasUidMissing: !existing.clerkId }, '[campaigns/me/context] updated existing user (Firebase)');
      return res.json({ ok: true, user: updated, created: false });
    } catch (err) {
      const detail = { name: err?.name, code: err?.code, meta: err?.meta, message: err?.message, userId: req.userId, workspaceId: req.workspaceId };
      logger.error(detail, '[campaigns/me/context] Prisma write failed — check schema migrations');
      return res.status(500).json({
        error:  'Could not save context',
        code:   err?.code ?? null,
        detail: err?.message ?? 'Unknown error',
        hint:   err?.code === 'P2021' || /does not exist/i.test(err?.message || '') ? 'The User table or context column is missing. Run: npx prisma migrate deploy' : null,
      });
    }
  });
}
