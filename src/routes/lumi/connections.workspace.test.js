import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, listConnections, updateCredentialAccount, runConnectorSync } = vi.hoisted(() => ({
  findUnique: vi.fn(), listConnections: vi.fn(),
  updateCredentialAccount: vi.fn(), runConnectorSync: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique } } }));
vi.mock('../../services/connectors/credentialStore.js', () => ({ listConnections, updateCredentialAccount }));
vi.mock('../../services/connectors/ConnectorSyncService.js', () => ({ runConnectorSync }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../middleware/requireCollabRole.js', () => ({ requireCollabRole: () => (_req, _res, next) => next() }));

import { connectionsRouter } from './connections.js';

const WS = 'ws-resolved';
const PRIVATE_ERROR = 'private database detail for private-user';
const endpoints = [
  { method: 'get', path: '/connections', error: 'ConnectionsUnavailable', message: 'Request failed' },
  { method: 'post', path: '/connections/sync', error: 'SyncFailed', message: 'Sync failed' },
  { method: 'patch', path: '/connections/account', error: 'AccountSwitchFailed', message: 'Request failed' },
];
function call(endpoint, identity = { userId: 'private-user' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, identity); next(); });
  app.use('/api/lumi', connectionsRouter);
  return request(app)[endpoint.method](`/api/lumi${endpoint.path}`)
    .send({ platform: 'META', accountId: 'act_2' });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ workspaceId: WS });
  listConnections.mockResolvedValue([{ platform: 'META', availableAccounts: [{ id: 'act_2' }] }]);
  updateCredentialAccount.mockResolvedValue(true);
  runConnectorSync.mockResolvedValue({ synced: 0, failed: 0, results: [] });
});

describe.each(endpoints)('$method $path — workspace resolution', (endpoint) => {
  it('uses the middleware workspace without a fallback lookup', async () => {
    const response = await call(endpoint, { workspaceId: WS, userId: 'private-user' });
    expect(response.status).toBe(200);
    expect(findUnique).not.toHaveBeenCalled();
    if (endpoint.method === 'post') expect(runConnectorSync).toHaveBeenCalledWith(WS, expect.any(Object));
    else expect(listConnections).toHaveBeenCalledWith(WS);
  });

  it('uses the successfully resolved fallback workspace', async () => {
    const response = await call(endpoint);
    expect(response.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith({ where: { clerkId: 'private-user' }, select: { workspaceId: true } });
    if (endpoint.method === 'post') expect(runConnectorSync).toHaveBeenCalledWith(WS, expect.any(Object));
    else expect(listConnections).toHaveBeenCalledWith(WS);
  });

  it.each([null, { workspaceId: null }])('preserves confirmed absence for lookup result %j', async (user) => {
    findUnique.mockResolvedValue(user);
    const response = await call(endpoint);
    if (endpoint.method === 'get') {
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ workspaceId: null, connections: [] });
    } else {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'WorkspaceNotFound', message: 'No workspace for this user' });
    }
    expect(listConnections).not.toHaveBeenCalled();
    expect(runConnectorSync).not.toHaveBeenCalled();
    expect(updateCredentialAccount).not.toHaveBeenCalled();
  });

  it('returns the safe operational failure envelope when fallback lookup throws', async () => {
    findUnique.mockRejectedValue(new Error(PRIVATE_ERROR));
    const response = await call(endpoint);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: endpoint.error, message: endpoint.message });
    expect(response.text).not.toContain(PRIVATE_ERROR);
    expect(response.text).not.toContain('private-user');
    expect(response.body.error).not.toBe('WorkspaceNotFound');
    expect(listConnections).not.toHaveBeenCalled();
    expect(runConnectorSync).not.toHaveBeenCalled();
    expect(updateCredentialAccount).not.toHaveBeenCalled();
  });

  it('preserves absence when no fallback identity is available', async () => {
    const response = await call(endpoint, {});
    expect(response.status).toBe(endpoint.method === 'get' ? 200 : 400);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

it('a known workspace with zero credentials remains distinct from unresolved workspace absence', async () => {
  listConnections.mockResolvedValue([]);
  const response = await call(endpoints[0], { workspaceId: WS });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ workspaceId: WS, connections: [] });
});
