// ============================================================
// PATCH /api/admin/workspaces/:id/plan — feature-gating entitlement
// ------------------------------------------------------------
// The manual upgrade path (no billing). Supertest against the workspacesRouter
// behind the REAL requireAdmin gate; prisma + logger are mocked so nothing
// touches a DB. Asserts: the ADMIN gate, enum validation, the happy update,
// and an honest 404 (never a silent no-op) when the workspace is missing.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { workspacesRouter } from './workspaces.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

const WS = 'ws-1';

function makeApp({ role = 'ADMIN' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'fb-1'; req.userRole = role; next(); });
  app.use('/api/admin/workspaces', requireAdmin, workspacesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The route pre-reads the current plan so the audit row can record a real
  // `before` — without this the update is never reached.
  prisma.workspace.findUnique.mockResolvedValue({ plan: 'FREE' });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'log-1' });
});

describe('PATCH /api/admin/workspaces/:id/plan', () => {
  it('sets a valid plan and returns the updated row', async () => {
    prisma.workspace.update.mockResolvedValue({ id: WS, name: 'Acme', plan: 'PRO' });

    const res = await request(makeApp())
      .patch(`/api/admin/workspaces/${WS}/plan`)
      .send({ plan: 'PRO' })
      .expect(200);

    expect(res.body).toEqual({ id: WS, name: 'Acme', plan: 'PRO' });
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: WS },
      data: { plan: 'PRO' },
      select: { id: true, name: true, plan: true },
    });
  });

  it('rejects an invalid plan with 400 and never touches the DB', async () => {
    const res = await request(makeApp())
      .patch(`/api/admin/workspaces/${WS}/plan`)
      .send({ plan: 'ENTERPRISE' })   // not in FREE|GROWTH|PRO
      .expect(400);

    expect(res.body.error).toMatch(/Invalid plan/i);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('rejects a missing plan with 400', async () => {
    await request(makeApp())
      .patch(`/api/admin/workspaces/${WS}/plan`)
      .send({})
      .expect(400);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it('returns 404 (not a silent success) when the workspace does not exist', async () => {
    prisma.workspace.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));

    const res = await request(makeApp())
      .patch(`/api/admin/workspaces/${WS}/plan`)
      .send({ plan: 'GROWTH' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it('forbids a non-admin caller (requireAdmin gate)', async () => {
    await request(makeApp({ role: 'VIEWER' }))
      .patch(`/api/admin/workspaces/${WS}/plan`)
      .send({ plan: 'PRO' })
      .expect(403);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });
});
