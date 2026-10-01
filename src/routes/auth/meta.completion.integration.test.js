// Real encrypted persistence, atomic linking, and operational readers in a private test schema.
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { dbAvailable } from '../../tests/dbProbe.js';
const store = vi.hoisted(() => ({ sql: null }));
vi.mock('../../utils/db.js', () => ({ getDb: () => store.sql }));
vi.mock('../../middleware/firebaseAuth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() }, workspace: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock('../../models/project.js', () => ({ getProject: vi.fn() }));
vi.mock('../../services/metaAdsService.js', () => ({ exchangeForLongLivedToken: vi.fn(), listAdAccounts: vi.fn(), fetchAccountCurrency: vi.fn(), fetchAccountTimezone: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { prisma } from '../../lib/prisma.js';
import { getProject } from '../../models/project.js';
import { exchangeForLongLivedToken, listAdAccounts, fetchAccountCurrency, fetchAccountTimezone } from '../../services/metaAdsService.js';
import { ensureCredentialSchema, saveCredential } from '../../models/credential.js';
import { listConnections, resolveCredential, attachWorkspaceToCredential, listActiveSyncable } from '../../services/connectors/credentialStore.js';
import { MetaConnector } from '../../services/connectors/MetaConnector.js';
import { runConnectorSync } from '../../services/connectors/ConnectorSyncService.js';
import { authMetaRouter, buildState } from './meta.js';
const DB_OK = await dbAvailable();
const schema = `sc08a_oauth_${process.pid}`;
const app = express().use('/api/auth/meta', authMetaRouter);
const callback = () => request(app).get('/api/auth/meta/callback').query({ code: 'code', state: buildState('uid1', 'p1', '/onboarding?step=connect') });
const flag = (res, name) => new URL(res.headers.location, 'http://localhost').searchParams.get(name);

describe.skipIf(!DB_OK)('OAuth completion agrees with actual workspace persistence', () => {
  beforeAll(async () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'test-signing-key');
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'a'.repeat(64));
    store.sql = postgres(process.env.DATABASE_URL, { max: 1, connection: { search_path: schema } });
    await store.sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await ensureCredentialSchema();
  });
  afterAll(async () => {
    await store.sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await store.sql.end();
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await store.sql`DROP TRIGGER IF EXISTS fail_reconcile ON marcom_credentials`;
    await store.sql`TRUNCATE marcom_credentials`;
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ access_token: 'short-token' }) })));
    getProject.mockResolvedValue({ id: 'p1' });
    prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws1' });
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'oauth-token', expiresAt: null });
    listAdAccounts.mockResolvedValue([{ id: 'act1', accountStatus: 1 }]);
    fetchAccountCurrency.mockResolvedValue('USD'); fetchAccountTimezone.mockResolvedValue('UTC');
  });
  it('success is discoverable by display, credential, batch-sync, and Meta authentication readers', async () => {
    const res = await callback().expect(302);
    expect(flag(res, 'meta_connected')).toBe('1');
    expect(await listConnections('ws1')).toEqual([expect.objectContaining({ platform: 'META', isActive: true, accountId: 'act1' })]);
    expect(await resolveCredential('ws1', 'META')).toMatchObject({ accessToken: 'oauth-token', accountId: 'act1' });
    expect(await listActiveSyncable('ws1')).toEqual([expect.objectContaining({ channel: 'META', accessToken: 'oauth-token' })]);
    expect(await new MetaConnector().authenticate('ws1')).toMatchObject({ ok: true, accountExternalId: 'act1' });
    const [row] = await store.sql`SELECT access_token_enc FROM marcom_credentials`;
    expect(row.access_token_enc).not.toContain('oauth-token');
  });
  it('missing workspace keeps a retryable stored credential outside workspace sync', async () => {
    prisma.user.findUnique.mockResolvedValue({ workspaceId: null });
    const res = await callback().expect(302);
    expect(flag(res, 'meta_error')).toBe('server_error');
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(await listConnections('ws1')).toEqual([]);
    expect(await resolveCredential('ws1', 'META')).toBeNull();
    expect(await new MetaConnector().authenticate('ws1')).toMatchObject({ ok: false });
    expect(await runConnectorSync('ws1')).toMatchObject({ synced: 0, results: [] });
    const [stored] = await store.sql`SELECT id FROM marcom_credentials`;
    prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws1' });
    expect(flag(await callback().expect(302), 'meta_connected')).toBe('1');
    const rows = await store.sql`SELECT id, workspace_id FROM marcom_credentials`;
    expect(rows).toEqual([{ id: stored.id, workspace_id: 'ws1' }]);
  });
  it('a nonexistent owned row returns stamped:false without fabricating a connection', async () => {
    expect(await attachWorkspaceToCredential({ projectId: 'missing', userId: 'uid1', platform: 'meta_ads', workspaceId: 'ws1' })).toEqual({ stamped: false });
    expect(await listConnections('ws1')).toEqual([]);
    expect(await listActiveSyncable('ws1')).toEqual([]);
  });
  it('a token without an ad account is retained for retry without becoming a workspace connection', async () => {
    listAdAccounts.mockResolvedValue([]);
    const res = await callback().expect(302);
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(flag(res, 'meta_error')).toBe('server_error');
    expect(await listConnections('ws1')).toEqual([]);
    expect(await listActiveSyncable('ws1')).toEqual([]);
    expect(await runConnectorSync('ws1')).toMatchObject({ synced: 0, results: [] });
    expect(await store.sql`SELECT workspace_id, account_id FROM marcom_credentials`).toEqual([{ workspace_id: null, account_id: null }]);
  });
  it('reconciliation failure rolls back the new link; retry retains one active authority', async () => {
    await saveCredential('other', { projectId: 'old', platform: 'meta_ads', accessToken: 'old-token', accountId: 'old-account' });
    await attachWorkspaceToCredential({ projectId: 'old', userId: 'other', platform: 'meta_ads', workspaceId: 'ws1' });
    await store.sql.unsafe(`CREATE OR REPLACE FUNCTION fail_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_active = false THEN RAISE EXCEPTION 'private DB detail'; END IF; RETURN NEW; END $$`);
    await store.sql.unsafe(`CREATE TRIGGER fail_reconcile BEFORE UPDATE ON marcom_credentials FOR EACH ROW EXECUTE FUNCTION fail_deactivation()`);
    const failed = await callback().expect(302);
    expect(flag(failed, 'meta_connected')).toBeNull();
    expect(flag(failed, 'meta_error')).toBe('server_error');
    const [newRow] = await store.sql`SELECT id, workspace_id FROM marcom_credentials WHERE project_id = 'p1'`;
    expect(newRow.workspace_id).toBeNull();
    // A prior valid connection is preserved; it is not confused with this failed attempt.
    expect(await resolveCredential('ws1', 'META')).toMatchObject({ accessToken: 'old-token', accountId: 'old-account' });
    expect((await listActiveSyncable('ws1')).map((r) => r.accountId)).toEqual(['old-account']);
    await store.sql`DROP TRIGGER fail_reconcile ON marcom_credentials`;
    expect(flag(await callback().expect(302), 'meta_connected')).toBe('1');
    expect((await store.sql`SELECT id FROM marcom_credentials WHERE project_id = 'p1'`)[0].id).toBe(newRow.id);
    expect((await listActiveSyncable('ws1')).map((r) => r.accountId)).toEqual(['act1']);
    expect((await store.sql`SELECT id FROM marcom_credentials`)).toHaveLength(2);
  });
});
