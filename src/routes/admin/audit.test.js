// ============================================================
// Admin action log — the read route + the four wired writes
// ------------------------------------------------------------
// Supertest against the assembled adminRouter with a fake auth middleware
// (mirrors admin.test.js). req.user carries an email because that, not the
// uid, is what an operator actually reads in the panel.
//
// The write assertions are deliberately end-to-end through the real routes
// rather than unit tests of recordAdminAction: the helper swallows every
// error, so a route that forgot to call it — or called it with the wrong
// before/after — would look identical to a working one from the outside.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    workspace: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
import { seedDemoWorkspace } from '../../../prisma/seed.js';
import { adminRouter } from './index.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

const ADMIN_UID = 'firebase-admin-1';
const ADMIN_EMAIL = 'ops@marcom.dev';

function makeApp({ role = 'ADMIN', email = ADMIN_EMAIL } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = ADMIN_UID;
    req.userRole = role;
    req.user = { uid: ADMIN_UID, email };
    next();
  });
  app.use('/api/admin', requireAdmin, adminRouter);
  return app;
}

const row = (over = {}) => ({
  id: 'log-1', actorEmail: ADMIN_EMAIL, type: 'CHANGE_PLAN',
  targetType: 'WORKSPACE', targetId: 'ws-1', workspaceId: 'ws-1',
  before: { plan: 'FREE' }, after: { plan: 'PRO' },
  createdAt: new Date('2026-07-27T10:00:00.000Z'), ...over,
});

/** The `data` of the Nth audit write. */
const audited = (n = 0) => prisma.adminAuditLog.create.mock.calls[n][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'log-1' });
  prisma.adminAuditLog.findMany.mockResolvedValue([]);
});

// ════════════════════════════════════════════════════════════
describe('GET /api/admin/audit', () => {
  it('returns rows newest-first', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([row()]);
    const res = await request(makeApp()).get('/api/admin/audit').expect(200);

    expect(res.body.logs).toHaveLength(1);
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('defaults to 50 and caps at 200', async () => {
    await request(makeApp()).get('/api/admin/audit').expect(200);
    expect(prisma.adminAuditLog.findMany.mock.calls[0][0].take).toBe(50);

    await request(makeApp()).get('/api/admin/audit?limit=5000').expect(200);
    expect(prisma.adminAuditLog.findMany.mock.calls[1][0].take).toBe(200);
  });

  // NaN would reach Prisma as `take: NaN` and throw — a junk param must not 500.
  it.each(['abc', '0', '-5', ''])('falls back to the default for limit=%s', async (limit) => {
    await request(makeApp()).get(`/api/admin/audit?limit=${limit}`).expect(200);
    expect(prisma.adminAuditLog.findMany.mock.calls[0][0].take).toBe(50);
  });

  it('paginates on the createdAt cursor, not an offset', async () => {
    await request(makeApp()).get('/api/admin/audit?before=2026-07-27T10:00:00.000Z').expect(200);
    const arg = prisma.adminAuditLog.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ createdAt: { lt: new Date('2026-07-27T10:00:00.000Z') } });
    expect(arg.skip).toBeUndefined();
  });

  it('ignores an unparseable cursor rather than throwing on Invalid Date', async () => {
    await request(makeApp()).get('/api/admin/audit?before=not-a-date').expect(200);
    expect(prisma.adminAuditLog.findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it('returns a nextCursor only when the page is full', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([row()]); // 1 row, limit 50
    let res = await request(makeApp()).get('/api/admin/audit').expect(200);
    expect(res.body.nextCursor).toBeNull();

    prisma.adminAuditLog.findMany.mockResolvedValue([row(), row({ id: 'log-2' })]);
    res = await request(makeApp()).get('/api/admin/audit?limit=2').expect(200);
    expect(res.body.nextCursor).toBe('2026-07-27T10:00:00.000Z');
  });

  it('an empty log is an empty page, not a cursor loop', async () => {
    const res = await request(makeApp()).get('/api/admin/audit?limit=0').expect(200);
    expect(res.body).toEqual({ logs: [], nextCursor: null });
  });

  it('a VIEWER is 403d before any DB work', async () => {
    await request(makeApp({ role: 'VIEWER' })).get('/api/admin/audit').expect(403);
    expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled();
  });

  it('a DB failure is a 500 with no trace', async () => {
    prisma.adminAuditLog.findMany.mockRejectedValue(new Error('connection reset'));
    const res = await request(makeApp()).get('/api/admin/audit').expect(500);
    expect(JSON.stringify(res.body)).not.toMatch(/connection reset/);
  });
});

// ════════════════════════════════════════════════════════════
describe('PATCH /users/:id/role → CHANGE_ROLE', () => {
  const target = (over = {}) => ({
    id: 'u-1', email: 'member@acme.co', clerkId: 'firebase-member-9',
    workspaceId: 'ws-1', collabRole: 'STRATEGIST', ...over,
  });

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(target());
    prisma.user.count.mockResolvedValue(1);
    prisma.user.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'u-1', email: 'member@acme.co', collabRole: data.collabRole }));
  });

  it('records the actor, the target and the real before/after', async () => {
    await request(makeApp()).patch('/api/admin/users/u-1/role').send({ collabRole: 'BUYER' }).expect(200);

    expect(audited()).toMatchObject({
      actorUid: ADMIN_UID,
      actorEmail: ADMIN_EMAIL,
      type: 'CHANGE_ROLE',
      targetType: 'USER',
      targetId: 'u-1',
      workspaceId: 'ws-1',
      before: { collabRole: 'STRATEGIST' },
      after: { collabRole: 'BUYER', forced: false },
    });
  });

  // The forced downgrade is the only change here that can strand a workspace.
  // A row that didn't distinguish it would miss the reason this log exists.
  it('marks a forced last-strategist downgrade as forced', async () => {
    prisma.user.count.mockResolvedValue(0);
    await request(makeApp()).patch('/api/admin/users/u-1/role')
      .send({ collabRole: 'BUYER', force: true }).expect(200);

    expect(audited().after).toEqual({ collabRole: 'BUYER', forced: true });
  });

  it('writes nothing when the change was refused', async () => {
    prisma.user.count.mockResolvedValue(0);
    await request(makeApp()).patch('/api/admin/users/u-1/role').send({ collabRole: 'BUYER' }).expect(409);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('writes nothing when validation rejected the request', async () => {
    await request(makeApp()).patch('/api/admin/users/u-1/role').send({ collabRole: 'OWNER' }).expect(400);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  // The whole point of the best-effort helper.
  it('a failed audit write does NOT fail the role change', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(new Error('relation does not exist'));
    const res = await request(makeApp()).patch('/api/admin/users/u-1/role')
      .send({ collabRole: 'BUYER' }).expect(200);
    expect(res.body.user.collabRole).toBe('BUYER');
  });
});

// ════════════════════════════════════════════════════════════
describe('PATCH /workspaces/:id/plan → CHANGE_PLAN', () => {
  beforeEach(() => {
    prisma.workspace.findUnique.mockResolvedValue({ plan: 'FREE' });
    prisma.workspace.update.mockResolvedValue({ id: 'ws-1', name: 'Acme', plan: 'PRO' });
  });

  // The update's return value is already the NEW plan; building `before` from
  // it would record before === after and make the log useless.
  it('records the PREVIOUS plan, read before the update', async () => {
    await request(makeApp()).patch('/api/admin/workspaces/ws-1/plan').send({ plan: 'PRO' }).expect(200);

    expect(audited()).toMatchObject({
      type: 'CHANGE_PLAN', targetType: 'WORKSPACE', targetId: 'ws-1', workspaceId: 'ws-1',
      before: { plan: 'FREE' }, after: { plan: 'PRO' },
    });
  });

  it('a workspace with a null plan reads as FREE, not null', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ plan: null });
    await request(makeApp()).patch('/api/admin/workspaces/ws-1/plan').send({ plan: 'PRO' }).expect(200);
    expect(audited().before).toEqual({ plan: 'FREE' });
  });

  it('404s an unknown workspace without writing a row', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    await request(makeApp()).patch('/api/admin/workspaces/ws-x/plan').send({ plan: 'PRO' }).expect(404);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('writes nothing for an invalid plan', async () => {
    await request(makeApp()).patch('/api/admin/workspaces/ws-1/plan').send({ plan: 'ENTERPRISE' }).expect(400);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════
describe('demo seed / delete → SEED_DEMO, DELETE_DEMO', () => {
  it('SEED_DEMO carries the id the seeder actually minted', async () => {
    seedDemoWorkspace.mockResolvedValue({ workspaceId: 'ws-new' });
    await request(makeApp()).post('/api/admin/demo/seed').expect(201);

    const data = audited();
    expect(data).toMatchObject({ type: 'SEED_DEMO', targetType: 'WORKSPACE', targetId: 'ws-new', workspaceId: 'ws-new' });
    expect(data.after.name).toMatch(/^Demo —/);
    expect(data.before).toBeNull();
  });

  it('a failed seed writes nothing', async () => {
    seedDemoWorkspace.mockRejectedValue(new Error('seed blew up'));
    await request(makeApp()).post('/api/admin/demo/seed').expect(500);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('DELETE_DEMO records the name the workspace had', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1', name: 'Demo — Maison Salam · x' });
    prisma.workspace.delete.mockResolvedValue({});
    await request(makeApp()).delete('/api/admin/demo/ws-1').expect(200);

    expect(audited()).toMatchObject({
      type: 'DELETE_DEMO', targetType: 'WORKSPACE', targetId: 'ws-1', workspaceId: 'ws-1',
      before: { name: 'Demo — Maison Salam · x' },
    });
    expect(audited().after).toBeNull();
  });

  // The workspace is gone, so the row can only exist because the column has no
  // foreign key. If someone adds `@relation(onDelete: Cascade)` this stays green
  // in the mock but the row disappears in Postgres — hence the schema assertion
  // in the migration/schema pair, which this test documents rather than proves.
  it('stores workspaceId as a plain string, with no relational connect', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1', name: 'Demo — gone' });
    prisma.workspace.delete.mockResolvedValue({});
    await request(makeApp()).delete('/api/admin/demo/ws-1').expect(200);

    expect(audited().workspaceId).toBe('ws-1');
    expect(audited().workspace).toBeUndefined(); // never a nested connect
  });

  // Ordering: the row must describe something that happened.
  it('a refused delete (non-demo workspace) writes nothing', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1', name: 'Acme Production' });
    await request(makeApp()).delete('/api/admin/demo/ws-1').expect(403);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('a FAILED delete writes nothing — no row may assert a deletion that did not happen', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1', name: 'Demo — doomed' });
    prisma.workspace.delete.mockRejectedValue(new Error('deadlock detected'));
    await request(makeApp()).delete('/api/admin/demo/ws-1').expect(500);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
