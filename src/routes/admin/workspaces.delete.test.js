// ============================================================
// DELETE /api/admin/workspaces/:id — the irreversible one
// ------------------------------------------------------------
// 59 models cascade from workspaces, so this route destroys an entire customer
// account in one statement. These tests pin the four guards that stand in front
// of it and the one thing that does NOT cascade:
//
//   - typed confirmation must match the name EXACTLY
//   - an admin cannot delete the workspace they are signed in to
//   - other ADMIN members block the delete until explicitly forced
//   - marcom_credentials is raw SQL with no FK — it must be purged by hand, and
//     BEFORE the workspace row, or a failure orphans live OAuth tokens
//
// Supertest against the real router behind the real requireAdmin gate; prisma,
// logger and the credential store are mocked so nothing touches a DB.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    loopRun: { findMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/connectors/credentialStore.js', () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  deleteWorkspaceCredentials: vi.fn().mockResolvedValue(0),
  withWorkspaceCredentialTransaction: vi.fn(async (client, _id, operation) => operation(client)),
}));

import { prisma } from '../../lib/prisma.js';
import { deleteWorkspaceCredentials } from '../../services/connectors/credentialStore.js';
import { workspacesRouter } from './workspaces.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';

const WS = 'ws-1';
const NAME = 'Acme Media';
const COUNTS = {
  users: 3, decisions: 48, accounts: 1, campaignEntities: 12,
  adSets: 40, ads: 90, metricSnapshots: 5000, actions: 7,
};

const workspace = (over = {}) => ({
  id: WS, name: NAME, plan: 'PRO', createdAt: new Date('2026-01-01'),
  users: [], _count: { ...COUNTS }, ...over,
});

function makeApp({ role = 'ADMIN', workspaceId = 'other-ws', userId = 'fb-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = userId; req.userRole = role; req.workspaceId = workspaceId;
    req.user = { email: 'ops@marcom.io' };
    next();
  });
  app.use('/api/admin/workspaces', requireAdmin, workspacesRouter);
  return app;
}

const del = (body, opts) => request(makeApp(opts)).delete(`/api/admin/workspaces/${WS}`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue(workspace());
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.workspace.delete.mockResolvedValue({ id: WS });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'log-1' });
  deleteWorkspaceCredentials.mockResolvedValue(0);
});

describe('the ADMIN gate', () => {
  it('403s a non-admin before anything is read', async () => {
    const res = await del({ confirmName: NAME }, { role: 'USER' });
    expect(res.status).toBe(403);
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });
});

describe('typed confirmation', () => {
  it('deletes when the name matches exactly', async () => {
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, workspaceId: WS, name: NAME });
    expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: WS } });
  });

  it.each([
    ['a near miss', 'Acme Medi'],
    ['different case', 'acme media'],
    ['leading whitespace', ' Acme Media'],
    ['trailing whitespace', 'Acme Media '],
    ['empty', ''],
  ])('refuses %s without deleting', async (_label, confirmName) => {
    const res = await del({ confirmName });
    expect(res.status).toBe(400);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('refuses a missing confirmName', async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  // The operator needs to know WHAT to type; hiding it turns a safety guard
  // into a guessing game.
  it('tells the caller the exact expected name', async () => {
    const res = await del({ confirmName: 'wrong' });
    expect(res.body.expectedName).toBe(NAME);
  });
});

describe('self-protection', () => {
  it('refuses the workspace the caller is signed in to, even with a correct name', async () => {
    const res = await del({ confirmName: NAME }, { workspaceId: WS });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/signed in to/i);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  // Ordering matters: the self-check runs FIRST so an operator who typed their
  // own workspace's name correctly gets the real reason, not "name mismatch".
  it('reports the self-delete reason ahead of a name mismatch', async () => {
    const res = await del({ confirmName: 'wrong' }, { workspaceId: WS });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/signed in to/i);
  });
});

describe('other admins', () => {
  const withAdmins = () => prisma.workspace.findUnique.mockResolvedValue(
    workspace({ users: [{ id: 'fb-2', email: 'other@acme.io' }] }),
  );

  it('blocks and names them rather than deleting silently', async () => {
    withAdmins();
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(409);
    expect(res.body.admins).toEqual(['other@acme.io']);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('force deletes once the operator opts in', async () => {
    withAdmins();
    const res = await del({ confirmName: NAME, force: true });
    expect(res.status).toBe(200);
    expect(prisma.workspace.delete).toHaveBeenCalled();
  });

  it('records that the delete was forced', async () => {
    withAdmins();
    await del({ confirmName: NAME, force: true });
    expect(prisma.adminAuditLog.create.mock.calls[0][0].data.before.forced).toBe(true);
  });

  // The caller's own ADMIN membership is not somebody else's.
  it('does not count the caller as a blocking admin', async () => {
    prisma.workspace.findUnique.mockResolvedValue(
      workspace({ users: [{ id: 'fb-1', email: 'ops@marcom.io' }] }),
    );
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(200);
  });
});

describe('credentials — the table that does not cascade', () => {
  it('purges them, since marcom_credentials has no FK to workspaces', async () => {
    await del({ confirmName: NAME });
    expect(deleteWorkspaceCredentials).toHaveBeenCalledWith(WS, prisma);
  });

  // If the purge throws AFTER the workspace is gone, the tokens are orphaned
  // with no UI left that could reach them. Order is the only protection.
  it('purges BEFORE deleting the workspace', async () => {
    const order = [];
    deleteWorkspaceCredentials.mockImplementation(async () => { order.push('credentials'); return 2; });
    prisma.workspace.delete.mockImplementation(async () => { order.push('workspace'); return { id: WS }; });
    await del({ confirmName: NAME });
    expect(order).toEqual(['credentials', 'workspace']);
  });

  it('aborts with the workspace intact when the purge fails', async () => {
    deleteWorkspaceCredentials.mockRejectedValue(new Error('db down'));
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(500);
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('reports how many were revoked', async () => {
    deleteWorkspaceCredentials.mockResolvedValue(2);
    const res = await del({ confirmName: NAME });
    expect(res.body.credentialsDeleted).toBe(2);
  });

  it('a workspace that never connected a channel deletes fine', async () => {
    deleteWorkspaceCredentials.mockResolvedValue(0);
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(200);
    expect(res.body.credentialsDeleted).toBe(0);
  });
});

describe('audit', () => {
  it('records DELETE_WORKSPACE, not DELETE_DEMO', async () => {
    await del({ confirmName: NAME });
    expect(prisma.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
      type: 'DELETE_WORKSPACE', targetType: 'WORKSPACE', targetId: WS, workspaceId: WS,
    });
  });

  // The audit row is the ONLY surviving record of what was destroyed — after
  // the cascade there is nothing left to count.
  it('keeps the counts that no longer exist anywhere else', async () => {
    await del({ confirmName: NAME });
    const { before } = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(before.counts).toMatchObject(COUNTS);
    expect(before.name).toBe(NAME);
  });

  it('writes no `after` — there is no after', async () => {
    await del({ confirmName: NAME });
    expect(prisma.adminAuditLog.create.mock.calls[0][0].data.after ?? null).toBeNull();
  });

  // A row written first would permanently assert a deletion a failed statement
  // never performed.
  it('records nothing when the delete itself fails', async () => {
    prisma.workspace.delete.mockRejectedValue(new Error('fk violation'));
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(500);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('missing workspace', () => {
  it('404s instead of a silent no-op', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(404);
    expect(deleteWorkspaceCredentials).not.toHaveBeenCalled();
    expect(prisma.workspace.delete).not.toHaveBeenCalled();
  });

  it('404s on a P2025 race (deleted between read and delete)', async () => {
    prisma.workspace.delete.mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }));
    const res = await del({ confirmName: NAME });
    expect(res.status).toBe(404);
  });
});
