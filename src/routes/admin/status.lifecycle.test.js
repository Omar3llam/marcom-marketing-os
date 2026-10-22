import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  queues: [], query: vi.fn(),
  connection: { status: 'ready', ping: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { $queryRaw: f.query } }));
vi.mock('../../utils/firebaseAdmin.js', () => ({
  default: {}, getFirebaseAdminReadiness: () => ({ ready: false }),
}));
vi.mock('../../utils/logger.js', () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }));
vi.mock('../../queues/connection.js', () => ({
  bullConnection: f.connection, REDIS_DISABLED: false, QUEUE_PREFIX: 'status-fixture',
  verifyRedisReadiness: async () => ({ connection: f.connection }),
  closeRedisConnection: vi.fn(),
}));
vi.mock('bullmq', () => ({ Queue: class {
  constructor(name) {
    this.name = name;
    this.counts = { waiting: f.queues.length + 1, active: 2, completed: 7, failed: 0, delayed: 3 };
    this.getJobCounts = vi.fn(async () => ({ ...this.counts }));
    this.on = vi.fn(() => this);
    this.waitUntilReady = vi.fn(async () => {});
    this.close = vi.fn(async () => {});
    f.queues.push(this);
  }
} }));

let registry;
let statusRouter;
let requireAuth;
let requireAdmin;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); f.queues = [];
  f.query.mockResolvedValue([{ '?column?': 1 }]);
  f.connection.ping.mockResolvedValue('PONG');
  // Import the real route while every real registry binding is still null.
  ({ statusRouter } = await import('./status.js'));
  registry = await import('../../queues/index.js');
  ({ requireAuth } = await import('../../middleware/firebaseAuth.js'));
  ({ requireAdmin } = await import('../../middleware/requireAdmin.js'));
});
afterEach(async () => { await registry?.closeQueues(); });

function app({ authenticated = true, role = 'ADMIN' } = {}) {
  const server = express();
  server.use((req, _res, next) => {
    if (authenticated) req.user = { uid: 'synthetic-admin' };
    req.userRole = role;
    next();
  });
  // Same real guards and order as the unchanged server mount; no Firebase call.
  server.use('/api/admin/status', requireAuth, requireAdmin, statusRouter);
  return server;
}

function expectDisabled(queues) {
  expect(Object.keys(queues).sort()).toEqual(['agentic', 'campaign-sync', 'executions', 'maintenance', 'narrative', 'observer']);
  for (const value of Object.values(queues)) expect(value).toEqual({ disabled: true });
}

describe('Admin status follows the live queue lifecycle', () => {
  it('reports all queues disabled before explicit initialization', async () => {
    const res = await request(app()).get('/api/admin/status').expect(200);
    expectDisabled(res.body.queues);
    expect(f.queues).toHaveLength(0);
  });
  it('reports the actual six queue counts after initialization following route import', async () => {
    await registry.initializeQueues();
    const res = await request(app()).get('/api/admin/status').expect(200);
    expect(f.queues).toHaveLength(6);
    for (const queue of f.queues) {
      expect(res.body.queues[queue.name]).toEqual(queue.counts);
      expect(queue.getJobCounts).toHaveBeenCalledTimes(1);
    }
    expect(res.body.db).toEqual({ ok: true, latencyMs: expect.any(Number) });
    expect(res.body.redis).toEqual({ ok: true, disabled: false });
    expect(res.body.generatedAt).toEqual(expect.any(String));
  });
  it('reports queues disabled again after cleanup and never reads closed handles', async () => {
    await registry.initializeQueues();
    await registry.closeQueues();
    const res = await request(app()).get('/api/admin/status').expect(200);
    expectDisabled(res.body.queues);
    for (const queue of f.queues) expect(queue.getJobCounts).not.toHaveBeenCalled();
  });
  it('preserves per-queue error isolation while returning other live counts', async () => {
    await registry.initializeQueues();
    f.queues[2].getJobCounts.mockRejectedValue(new Error('synthetic queue unavailable'));
    const res = await request(app()).get('/api/admin/status').expect(200);
    expect(res.body.queues.executions).toEqual({ ok: false, error: 'synthetic queue unavailable' });
    expect(res.body.queues.observer).toEqual(f.queues[0].counts);
  });
  it.each(['VIEWER', 'CLIENT'])('refuses %s before DB, Redis or queue status reads', async role => {
    await registry.initializeQueues();
    const res = await request(app({ role })).get('/api/admin/status').expect(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.connection.ping).not.toHaveBeenCalled();
    for (const queue of f.queues) expect(queue.getJobCounts).not.toHaveBeenCalled();
  });
  it('refuses an anonymous request even when an ADMIN role is supplied by the fixture', async () => {
    const res = await request(app({ authenticated: false })).get('/api/admin/status').expect(401);
    expect(res.body).toEqual({ error: 'Unauthenticated' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.connection.ping).not.toHaveBeenCalled();
    expect(f.queues).toHaveLength(0);
  });
});
