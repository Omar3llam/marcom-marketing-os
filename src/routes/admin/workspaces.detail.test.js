// ============================================================
// GET /api/admin/workspaces/:id — the operator drill-down
// ------------------------------------------------------------
// Supertest against workspacesRouter behind the REAL requireAdmin gate.
// prisma, credentialStore and logger are mocked, so nothing touches a DB.
//
// The assertions that matter most are the two safety properties: the response
// never carries a token, and a connector read that fails degrades to a flagged
// block instead of taking the whole drill-down down with it.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    loopRun: { findMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock('../../services/connectors/credentialStore.js', () => ({ listConnections: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { listConnections } from '../../services/connectors/credentialStore.js';
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

const workspace = (over = {}) => ({
  id: WS, name: 'Acme', plan: 'PRO', currency: 'EGP',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  spendTier: 't2', objective: 'roas', adChannels: ['META'],
  measurementTier: 'NONE', networkConsent: false,
  users: [{ id: 'u-1', email: 'a@acme.co', role: 'VIEWER', collabRole: 'STRATEGIST', createdAt: new Date() }],
  _count: { users: 1, campaignEntities: 12, decisions: 40, accounts: 2, metricSnapshots: 900 },
  ...over,
});

const connection = (over = {}) => ({
  platform: 'META', isActive: true, accountId: 'act_1',
  lastSyncedAt: '2026-07-27T09:00:00.000Z', availableAccounts: [],
  health: {
    platform: 'meta_ads',
    lastSuccessfulSync: '2026-07-27T09:00:00.000Z',
    lastAttemptedSync: '2026-07-27T10:00:00.000Z',
    lastError: null,
    recordsImported: 42,
  },
  ...over,
});

const get = (id = WS) => request(makeApp()).get(`/api/admin/workspaces/${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue(workspace());
  prisma.loopRun.findMany.mockResolvedValue([]);
  listConnections.mockResolvedValue([connection()]);
});

describe('GET /workspaces/:id — the core read', () => {
  it('returns the workspace, its members, counts, sweeps and connectors', async () => {
    const res = await get().expect(200);
    expect(res.body.workspace.name).toBe('Acme');
    expect(res.body.workspace.users).toHaveLength(1);
    expect(res.body.workspace._count.campaignEntities).toBe(12);
    expect(res.body.loopRuns).toEqual([]);
    expect(res.body.connectors.ok).toBe(true);
  });

  it('surfaces the onboarding fields the list has never shown', async () => {
    const res = await get().expect(200);
    expect(res.body.workspace).toMatchObject({
      spendTier: 't2', objective: 'roas', adChannels: ['META'],
      measurementTier: 'NONE', networkConsent: false,
    });
  });

  // isDemo is not a column — it is the "Demo —" name sentinel, same rule the
  // list and the delete guard use.
  it('derives isDemo from the name sentinel, not a column', async () => {
    let res = await get().expect(200);
    expect(res.body.workspace.isDemo).toBe(false);

    prisma.workspace.findUnique.mockResolvedValue(workspace({ name: 'Demo — Maison Salam' }));
    res = await get().expect(200);
    expect(res.body.workspace.isDemo).toBe(true);
  });

  it('404s an unknown workspace without reading connectors or sweeps', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    await get('ws-x').expect(404);
    expect(listConnections).not.toHaveBeenCalled();
    expect(prisma.loopRun.findMany).not.toHaveBeenCalled();
  });

  it('a VIEWER is 403d before any DB work', async () => {
    await request(makeApp({ role: 'VIEWER' })).get(`/api/admin/workspaces/${WS}`).expect(403);
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });

  it('a Prisma failure is a 500 with no trace', async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error('connection reset'));
    const res = await get().expect(500);
    expect(JSON.stringify(res.body)).not.toMatch(/connection reset/);
  });
});

describe('GET /workspaces/:id — members', () => {
  it('queries members by workspaceId and caps them at 50', async () => {
    await get().expect(200);
    const { select } = prisma.workspace.findUnique.mock.calls[0][0];
    expect(select.users.take).toBe(50);
    expect(select.users.orderBy).toEqual({ createdAt: 'desc' });
  });

  // The cap would otherwise make a 300-member workspace read as 50.
  it('reports the true member total from _count, independent of the cap', async () => {
    prisma.workspace.findUnique.mockResolvedValue(workspace({ _count: { ...workspace()._count, users: 312 } }));
    const res = await get().expect(200);
    expect(res.body.workspace._count.users).toBe(312);
  });

  it('never selects a password or token column on the member rows', async () => {
    await get().expect(200);
    const userSelect = prisma.workspace.findUnique.mock.calls[0][0].select.users.select;
    expect(Object.keys(userSelect).sort()).toEqual(['collabRole', 'createdAt', 'email', 'id', 'role']);
  });
});

describe('GET /workspaces/:id — sweeps', () => {
  it('takes the latest 5, newest first', async () => {
    await get().expect(200);
    expect(prisma.loopRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: WS }, orderBy: { startedAt: 'desc' }, take: 5,
    }));
  });

  // LoopRun has no `status` column; selecting one would throw at runtime.
  it('selects only fields LoopRun actually has', async () => {
    await get().expect(200);
    const { select } = prisma.loopRun.findMany.mock.calls[0][0];
    expect(select.status).toBeUndefined();
    expect(select).toMatchObject({ closed: true, loopHealth: true, trigger: true, summary: true });
  });

  it('passes the sweeps through untouched', async () => {
    prisma.loopRun.findMany.mockResolvedValue([
      { id: 'lr-1', trigger: 'SCHEDULED', startedAt: '2026-07-27T08:00:00.000Z', finishedAt: null,
        closed: false, loopHealth: 'STALLED', staleStages: ['EXECUTE'], summary: 'Nothing executed' },
    ]);
    const res = await get().expect(200);
    expect(res.body.loopRuns[0]).toMatchObject({ loopHealth: 'STALLED', closed: false });
  });
});

describe('GET /workspaces/:id — connectors', () => {
  it('reuses listConnections rather than reading marcom_credentials directly', async () => {
    await get().expect(200);
    expect(listConnections).toHaveBeenCalledWith(WS);
  });

  it('maps the health record, keying freshness off the last SUCCESS', async () => {
    const res = await get().expect(200);
    expect(res.body.connectors.connections[0]).toEqual({
      platform: 'META', isActive: true, accountId: 'act_1',
      lastSyncedAt: '2026-07-27T09:00:00.000Z',
      lastSuccessfulSync: '2026-07-27T09:00:00.000Z',
      lastAttemptedSync: '2026-07-27T10:00:00.000Z',
      lastError: null, recordsImported: 42,
    });
  });

  it('surfaces a connector error instead of hiding a broken sync', async () => {
    listConnections.mockResolvedValue([connection({
      health: { lastSuccessfulSync: '2026-07-20T00:00:00.000Z', lastAttemptedSync: '2026-07-27T10:00:00.000Z',
        lastError: 'OAuthException: token expired', recordsImported: 0 },
    })]);
    const res = await get().expect(200);
    expect(res.body.connectors.connections[0].lastError).toMatch(/token expired/);
    // The prior success is preserved — a failed attempt is not "fresh".
    expect(res.body.connectors.connections[0].lastSuccessfulSync).toBe('2026-07-20T00:00:00.000Z');
  });

  it('a credential with no health record yields nulls, never invented values', async () => {
    listConnections.mockResolvedValue([connection({ health: null })]);
    const res = await get().expect(200);
    expect(res.body.connectors.connections[0]).toMatchObject({
      lastSuccessfulSync: null, lastAttemptedSync: null, lastError: null, recordsImported: null,
    });
  });

  it('a workspace with no credentials is an empty list, not an error', async () => {
    listConnections.mockResolvedValue([]);
    const res = await get().expect(200);
    expect(res.body.connectors).toEqual({ ok: true, connections: [] });
  });
});

describe('GET /workspaces/:id — independent degradation', () => {
  // getDb() returns null when DATABASE_URL is absent; listConnections then
  // throws on the tagged template. The other two thirds are already in hand.
  it('a thrown connector read degrades that block and still returns 200', async () => {
    listConnections.mockRejectedValue(new TypeError('sql is not a function'));
    const res = await get().expect(200);

    expect(res.body.connectors).toEqual({ ok: false, error: 'Connector status unavailable' });
    expect(res.body.workspace.name).toBe('Acme');   // the rest survived
    expect(res.body.loopRuns).toEqual([]);
  });

  it('the degraded error does not leak the underlying failure', async () => {
    listConnections.mockRejectedValue(new Error('password authentication failed for user "admin"'));
    const res = await get().expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password authentication/);
  });
});

// The panel is cross-workspace: an operator reading it sees every customer's
// connectors. listConnections is the display-safe reader precisely because it
// never selects the encrypted columns — a bespoke SELECT here would leak them.
describe('GET /workspaces/:id — tokens never leave the store', () => {
  it('drops token fields even if the store somehow returns them', async () => {
    listConnections.mockResolvedValue([{
      ...connection(),
      access_token_enc: 'ENCRYPTED-ACCESS',
      refresh_token_enc: 'ENCRYPTED-REFRESH',
      accessToken: 'PLAINTEXT-LEAK',
    }]);
    const body = JSON.stringify((await get().expect(200)).body);

    expect(body).not.toMatch(/ENCRYPTED-ACCESS/);
    expect(body).not.toMatch(/ENCRYPTED-REFRESH/);
    expect(body).not.toMatch(/PLAINTEXT-LEAK/);
    expect(body).not.toMatch(/accessToken|access_token|refresh_token/i);
  });
});
