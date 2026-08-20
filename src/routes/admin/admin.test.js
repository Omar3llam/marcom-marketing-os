// ============================================================
// Admin panel — route behaviour + the requireAdmin gate
// ------------------------------------------------------------
// Supertest against the assembled adminRouter with a fake auth middleware
// (mirrors lumi/rollback.test.js). prisma / queues / redis / the demo seeder
// are all mocked, so nothing touches a real DB, Redis, or runs the seed.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    // `count` backs the honest total on both lists — an unmocked one would
    // reject inside Promise.all and turn every list assertion into a 500.
    workspace: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn() },
    // The demo routes now record an admin-audit row. recordAdminAction
    // swallows everything, so an unmocked client would leave these tests green
    // while the write silently no-op'd — mock it so the call is real.
    adminAuditLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../../queues/index.js', () => ({
  actionQueue:    { getJobCounts: vi.fn() },
  observerQueue:  { getJobCounts: vi.fn() },
  syncQueue:      null, // exercises the null-guard (REDIS_DISABLED) path
  executionQueue: { getJobCounts: vi.fn() },
  agenticQueue:   { getJobCounts: vi.fn() },
  narrativeQueue: { getJobCounts: vi.fn() },
  maintenanceQueue: { getJobCounts: vi.fn() },
}));

vi.mock('../../queues/connection.js', () => ({
  REDIS_DISABLED: false,
  bullConnection: { ping: vi.fn() },
}));

vi.mock('../../../prisma/seed.js', () => ({
  seedDemoWorkspace: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { actionQueue, observerQueue, executionQueue, agenticQueue, narrativeQueue, maintenanceQueue } from '../../queues/index.js';
import { bullConnection } from '../../queues/connection.js';
import { seedDemoWorkspace } from '../../../prisma/seed.js';
import { adminRouter } from './index.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

function makeApp({ role = 'ADMIN' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-admin-1';
    req.userRole = role;
    req.workspaceId = 'ws-1';
    next();
  });
  app.use('/api/admin', requireAdmin, adminRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const q of [actionQueue, observerQueue, executionQueue, agenticQueue, narrativeQueue, maintenanceQueue]) {
    q.getJobCounts.mockResolvedValue({ waiting: 0, active: 1, completed: 5, failed: 2, delayed: 0 });
  }
  bullConnection.ping.mockResolvedValue('PONG');
  prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  prisma.workspace.count.mockResolvedValue(0);
  prisma.user.count.mockResolvedValue(0);
});

describe('requireAdmin gate', () => {
  it('rejects a VIEWER with 403 on every admin route, before any DB/queue work', async () => {
    const app = makeApp({ role: 'VIEWER' });
    for (const path of ['/api/admin/status', '/api/admin/workspaces', '/api/admin/users']) {
      await request(app).get(path).expect(403);
    }
    await request(app).post('/api/admin/demo/seed').expect(403);
    await request(app).delete('/api/admin/demo/ws-x').expect(403);

    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(seedDemoWorkspace).not.toHaveBeenCalled();
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('returns the canonical { error } shape (no stack trace)', async () => {
    const res = await request(makeApp({ role: 'CLIENT' })).get('/api/admin/status').expect(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
  });
});

describe('GET /api/admin/status', () => {
  it('returns db / redis / per-queue counts / worker crons', async () => {
    const res = await request(makeApp()).get('/api/admin/status').expect(200);

    expect(res.body.db).toEqual({ ok: true, latencyMs: expect.any(Number) });
    expect(res.body.redis).toEqual({ ok: true, disabled: false });
    expect(res.body.queues.executions).toEqual({ waiting: 0, active: 1, completed: 5, failed: 2, delayed: 0 });
    // R13-D / B3-C — the 'actions' queue is retired along with its worker.
    // Listing it here would report depth 0 forever, which reads as health
    // rather than as a queue nothing drains.
    expect(res.body.queues.actions).toBeUndefined();
    // null queue → honest disabled marker, never a throw.
    expect(res.body.queues['campaign-sync']).toEqual({ disabled: true });
    expect(res.body.workers.agentic.cron).toBeTruthy();
    expect(res.body.generatedAt).toEqual(expect.any(String));
  });

  // The retention sweep is the one cron with no enable flag, so the status tab
  // is where an operator confirms it exists and learns what it will delete —
  // the schedule alone does not say how much data survives it.
  it('reports the ai-usage retention cron and its retention window', async () => {
    const res = await request(makeApp()).get('/api/admin/status').expect(200);

    expect(res.body.workers['ai-usage-cleanup']).toEqual({
      cron: '0 3 * * *',
      retentionDays: 90,
    });
    expect(res.body.queues).toHaveProperty('maintenance');
  });

  it('reflects an AIUSAGE_MAX_AGE_DAYS override in the reported window', async () => {
    process.env.AIUSAGE_MAX_AGE_DAYS = '30';
    try {
      const res = await request(makeApp()).get('/api/admin/status').expect(200);
      expect(res.body.workers['ai-usage-cleanup'].retentionDays).toBe(30);
    } finally {
      delete process.env.AIUSAGE_MAX_AGE_DAYS;
    }
  });

  // A junk value must not be echoed back as the truth — cleanAiUsageLogs
  // clamps it to 90, and the status tab has to agree with what will happen.
  it('reports 90 days when the override is junk, matching the sweep’s own clamp', async () => {
    process.env.AIUSAGE_MAX_AGE_DAYS = 'abc';
    try {
      const res = await request(makeApp()).get('/api/admin/status').expect(200);
      expect(res.body.workers['ai-usage-cleanup'].retentionDays).toBe(90);
    } finally {
      delete process.env.AIUSAGE_MAX_AGE_DAYS;
    }
  });

  it('degrades the db section to { ok:false, error } instead of throwing', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp()).get('/api/admin/status').expect(200);
    expect(res.body.db.ok).toBe(false);
    expect(res.body.db.error).toBe('connection refused');
  });
});

describe('GET /api/admin/workspaces', () => {
  it('maps counts and flags demo workspaces by the name sentinel', async () => {
    prisma.workspace.findMany.mockResolvedValue([
      { id: 'w1', name: 'Maison Salam', currency: 'EGP', createdAt: new Date(), _count: { users: 3, decisions: 12 } },
      { id: 'w2', name: 'Demo — Maison Salam · 2026', currency: 'EGP', createdAt: new Date(), _count: { users: 1, decisions: 5 } },
    ]);
    // `total` is the count, NOT the page — it may legitimately exceed the rows.
    prisma.workspace.count.mockResolvedValue(312);

    const res = await request(makeApp()).get('/api/admin/workspaces').expect(200);
    expect(res.body.total).toBe(312);
    expect(res.body.workspaces[0]).toMatchObject({ name: 'Maison Salam', userCount: 3, decisionCount: 12, isDemo: false });
    expect(res.body.workspaces[1]).toMatchObject({ isDemo: true });
  });
});

describe('GET /api/admin/users', () => {
  it('flattens the workspace relation into workspaceId / workspaceName', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.co', role: 'ADMIN', collabRole: 'STRATEGIST', createdAt: new Date(), workspace: { id: 'w1', name: 'MARCOM' } },
    ]);
    prisma.user.count.mockResolvedValue(847);

    const res = await request(makeApp()).get('/api/admin/users').expect(200);
    expect(res.body.total).toBe(847);
    expect(res.body.users[0]).toMatchObject({ email: 'a@b.co', role: 'ADMIN', workspaceId: 'w1', workspaceName: 'MARCOM' });
  });
});

describe('POST /api/admin/demo/seed', () => {
  it('seeds a uniquely-named demo workspace and returns 201', async () => {
    seedDemoWorkspace.mockResolvedValue({ workspaceId: 'demo-ws-1', name: 'Demo — Maison Salam · 2026' });

    const res = await request(makeApp()).post('/api/admin/demo/seed').expect(201);
    expect(res.body).toMatchObject({ workspaceId: 'demo-ws-1', message: 'Demo workspace created' });

    expect(seedDemoWorkspace).toHaveBeenCalledTimes(1);
    const [, opts] = seedDemoWorkspace.mock.calls[0];
    expect(opts.key).toMatch(/^demo-/);
    expect(opts.name.startsWith('Demo —')).toBe(true);
  });

  it('returns 500 { error } when the seeder throws — never crashes', async () => {
    seedDemoWorkspace.mockRejectedValue(new Error('seed boom'));
    const res = await request(makeApp()).post('/api/admin/demo/seed').expect(500);
    expect(res.body).toEqual({ error: 'Failed to seed demo workspace' });
  });
});

describe('DELETE /api/admin/demo/:workspaceId', () => {
  it('deletes a demo workspace (name starts with the sentinel)', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'demo-ws-1', name: 'Demo — Maison Salam · 2026' });
    prisma.workspace.delete.mockResolvedValue({ id: 'demo-ws-1' });

    const res = await request(makeApp()).delete('/api/admin/demo/demo-ws-1').expect(200);
    expect(res.body).toEqual({ deleted: true, workspaceId: 'demo-ws-1' });
    expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: 'demo-ws-1' } });
  });

  it('REFUSES to delete a non-demo workspace (403, no delete call)', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'real-ws', name: 'Acme Corp' });

    const res = await request(makeApp()).delete('/api/admin/demo/real-ws').expect(403);
    expect(res.body).toEqual({ error: 'Refusing to delete a non-demo workspace' });
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('404s an unknown workspace', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    await request(makeApp()).delete('/api/admin/demo/nope').expect(404);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });
});
