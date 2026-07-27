// ============================================================
// PATCH /api/admin/users/:id/role
// ------------------------------------------------------------
// Supertest against the assembled adminRouter with a fake auth middleware
// (mirrors admin.test.js). The admin panel is the ONLY cross-workspace surface,
// so this route can both repair a locked-out workspace and — with force — strand
// one. Both paths are pinned here.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    workspace: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    adminAuditLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('../../queues/index.js', () => ({
  actionQueue: { getJobCounts: vi.fn() }, observerQueue: { getJobCounts: vi.fn() },
  syncQueue: null, executionQueue: { getJobCounts: vi.fn() },
  agenticQueue: { getJobCounts: vi.fn() }, narrativeQueue: { getJobCounts: vi.fn() },
}));
vi.mock('../../queues/connection.js', () => ({ REDIS_DISABLED: false, bullConnection: { ping: vi.fn() } }));
vi.mock('../../../prisma/seed.js', () => ({ seedDemoWorkspace: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { adminRouter } from './index.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

const ADMIN_UID = 'firebase-admin-1';

function makeApp({ role = 'ADMIN' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = ADMIN_UID; req.userRole = role; next(); });
  app.use('/api/admin', requireAdmin, adminRouter);
  return app;
}

const target = (over = {}) => ({
  id: 'u-1', email: 'member@acme.co', clerkId: 'firebase-member-9',
  workspaceId: 'ws-1', collabRole: 'STRATEGIST', ...over,
});

const patch = (body, id = 'u-1') => request(makeApp()).patch(`/api/admin/users/${id}/role`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(target());
  prisma.user.count.mockResolvedValue(1); // another strategist exists by default
  prisma.user.update.mockImplementation(({ data }) =>
    Promise.resolve({ id: 'u-1', email: 'member@acme.co', collabRole: data.collabRole }));
});

describe('PATCH /users/:id/role — validation', () => {
  it.each(['STRATEGIST', 'BUYER', 'CLIENT'])('accepts %s', async (collabRole) => {
    const res = await patch({ collabRole }).expect(200);
    expect(res.body.user.collabRole).toBe(collabRole);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { collabRole } }));
  });

  // null is legitimate: roleScope reads it as STRATEGIST.
  it('accepts null and writes null, not the string "null"', async () => {
    await patch({ collabRole: null }).expect(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { collabRole: null } }));
  });

  it.each(['ADMIN', 'OWNER', 'strategist', '', 42])('rejects %s with 400', async (collabRole) => {
    await patch({ collabRole }).expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('404s an unknown user without touching the row', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await patch({ collabRole: 'BUYER' }).expect(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// req.userId is the FIREBASE uid, which lives on User.clerkId. Comparing it to
// User.id (a uuid) would never match, leaving the guard decorative.
describe('PATCH /users/:id/role — self-guard', () => {
  it('refuses to change your OWN role, matched on clerkId', async () => {
    prisma.user.findUnique.mockResolvedValue(target({ clerkId: ADMIN_UID }));
    await patch({ collabRole: 'BUYER' }).expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not confuse User.id with the Firebase uid', async () => {
    // The row's id equals the caller's uid string, but clerkId does not — this
    // is NOT the caller, so the change must go through.
    prisma.user.findUnique.mockResolvedValue(target({ id: ADMIN_UID, clerkId: 'someone-else' }));
    await request(makeApp()).patch(`/api/admin/users/${ADMIN_UID}/role`).send({ collabRole: 'BUYER' }).expect(200);
  });

  it('a null clerkId never matches the caller', async () => {
    prisma.user.findUnique.mockResolvedValue(target({ clerkId: null }));
    await patch({ collabRole: 'BUYER' }).expect(200);
  });
});

describe('PATCH /users/:id/role — last-strategist guard', () => {
  it('409s when demoting the last strategist', async () => {
    prisma.user.count.mockResolvedValue(0);
    const res = await patch({ collabRole: 'BUYER' }).expect(409);
    expect(res.body.error).toBe('LAST_STRATEGIST');
    expect(res.body.message).toMatch(/last strategist/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // An admin can also repair the workspace afterwards, so the override exists —
  // but it must be asked for explicitly, in the body.
  it('force: true overrides the guard', async () => {
    prisma.user.count.mockResolvedValue(0);
    await patch({ collabRole: 'BUYER', force: true }).expect(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('force in the QUERY STRING does not override — the body is the contract', async () => {
    prisma.user.count.mockResolvedValue(0);
    await request(makeApp())
      .patch('/api/admin/users/u-1/role?force=true')
      .send({ collabRole: 'BUYER' })
      .expect(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a null-role user counts as a strategist for the guard', async () => {
    prisma.user.findUnique.mockResolvedValue(target({ collabRole: null }));
    prisma.user.count.mockResolvedValue(0);
    await patch({ collabRole: 'CLIENT' }).expect(409);
  });

  it('never blocks a change that removes no strategist (BUYER → CLIENT)', async () => {
    prisma.user.findUnique.mockResolvedValue(target({ collabRole: 'BUYER' }));
    prisma.user.count.mockResolvedValue(0);
    await patch({ collabRole: 'CLIENT' }).expect(200);
  });

  it('never blocks a promotion', async () => {
    prisma.user.findUnique.mockResolvedValue(target({ collabRole: 'CLIENT' }));
    prisma.user.count.mockResolvedValue(0);
    await patch({ collabRole: 'STRATEGIST' }).expect(200);
  });
});

describe('PATCH /users/:id/role — gate + failures', () => {
  it('a VIEWER is 403d before any DB work', async () => {
    await request(makeApp({ role: 'VIEWER' })).patch('/api/admin/users/u-1/role')
      .send({ collabRole: 'BUYER' }).expect(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('a vanished row (P2025) surfaces as 404, never a 500', async () => {
    prisma.user.update.mockRejectedValue(Object.assign(new Error('nope'), { code: 'P2025' }));
    await patch({ collabRole: 'BUYER' }).expect(404);
  });

  it('an unexpected DB failure is a 500 with no trace', async () => {
    prisma.user.update.mockRejectedValue(new Error('connection reset'));
    const res = await patch({ collabRole: 'BUYER' }).expect(500);
    expect(JSON.stringify(res.body)).not.toMatch(/connection reset/);
  });
});
