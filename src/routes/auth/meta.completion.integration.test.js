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
const WS = '00000000-0000-4000-8000-000000005002';
const schema = `sc08a_oauth_${process.pid}`;
const app = express().use('/api/auth/meta', authMetaRouter);
const callback = () => request(app).get('/api/auth/meta/callback').query({ code: 'code', state: buildState('uid1', 'p1', '/onboarding?step=connect', WS) });
const flag = (res, name) => new URL(res.headers.location, 'http://localhost').searchParams.get(name);

describe.skipIf(!DB_OK)('OAuth completion agrees with actual workspace persistence', () => {
  beforeAll(async () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'test-signing-key');
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'a'.repeat(64));
    store.sql = postgres(process.env.DATABASE_URL, { max: 1, connection: { search_path: schema } });
    await store.sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await store.sql`CREATE TABLE workspaces (id UUID PRIMARY KEY)`;
    await store.sql`CREATE TABLE users (id UUID DEFAULT gen_random_uuid(), "clerkId" TEXT, "workspaceId" UUID, "collabRole" TEXT)`;
    await store.sql`CREATE TABLE marcom_projects (project_id TEXT PRIMARY KEY, user_id TEXT)`;
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
    await store.sql`TRUNCATE users, workspaces, marcom_projects`;
    await store.sql`INSERT INTO workspaces VALUES (${WS})`;
    await store.sql`INSERT INTO users ("clerkId", "workspaceId", "collabRole") VALUES ('uid1', ${WS}, 'STRATEGIST')`;
    await store.sql`INSERT INTO marcom_projects VALUES ('p1', 'uid1')`;
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ access_token: 'short-token' }) })));
    getProject.mockResolvedValue({ id: 'p1' });
    prisma.user.findUnique.mockResolvedValue({ workspaceId: WS });
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'oauth-token', expiresAt: null });
    listAdAccounts.mockResolvedValue([{ id: 'act1', accountStatus: 1 }]);
    fetchAccountCurrency.mockResolvedValue('USD'); fetchAccountTimezone.mockResolvedValue('UTC');
  });
  it('success is discoverable by display, credential, batch-sync, and Meta authentication readers', async () => {
    const res = await callback().expect(302);
    expect(flag(res, 'meta_connected')).toBe('1');
    expect(await listConnections(WS)).toEqual([expect.objectContaining({ platform: 'META', isActive: true, accountId: 'act1' })]);
    expect(await resolveCredential(WS, 'META')).toMatchObject({ accessToken: 'oauth-token', accountId: 'act1' });
    expect(await listActiveSyncable(WS)).toEqual([expect.objectContaining({ channel: 'META', accessToken: 'oauth-token' })]);
    expect(await new MetaConnector().authenticate(WS)).toMatchObject({ ok: true, accountExternalId: 'act1' });
    const [row] = await store.sql`SELECT access_token_enc FROM marcom_credentials`;
    expect(row.access_token_enc).not.toContain('oauth-token');
  });
  it('PO supersedes partial retention: missing current identity saves nothing; authorized retry succeeds', async () => {
    await store.sql`DELETE FROM users`;
    const res = await callback().expect(302);
    expect(flag(res, 'meta_error')).toBe('role_forbidden');
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(await listConnections(WS)).toEqual([]);
    expect(await resolveCredential(WS, 'META')).toBeNull();
    expect(await new MetaConnector().authenticate(WS)).toMatchObject({ ok: false });
    expect(await runConnectorSync(WS)).toMatchObject({ synced: 0, results: [] });
    expect(await store.sql`SELECT id FROM marcom_credentials`).toHaveLength(0);
    await store.sql`INSERT INTO users ("clerkId", "workspaceId", "collabRole") VALUES ('uid1', ${WS}, 'STRATEGIST')`;
    expect(flag(await callback().expect(302), 'meta_connected')).toBe('1');
    const rows = await store.sql`SELECT id, workspace_id FROM marcom_credentials`;
    expect(rows).toEqual([expect.objectContaining({ workspace_id: WS })]);
  });
  it('a nonexistent owned row returns stamped:false without fabricating a connection', async () => {
    expect(await attachWorkspaceToCredential({ projectId: 'missing', userId: 'uid1', platform: 'meta_ads', workspaceId: WS })).toEqual({ stamped: false });
    expect(await listConnections(WS)).toEqual([]);
    expect(await listActiveSyncable(WS)).toEqual([]);
  });
  it.each([null, 'UNKNOWN', 'BUYER', 'CLIENT'])('refuses authoritative SQL role %s before persisting any credential', async (role) => {
    await store.sql`UPDATE users SET "collabRole" = ${role} WHERE "clerkId" = 'uid1'`;
    const res = await callback().expect(302);
    expect(flag(res, 'meta_error')).toBe('role_forbidden');
    expect(await store.sql`SELECT id FROM marcom_credentials`).toHaveLength(0);
  });
  it('PO supersedes token-only retention: incomplete discovery leaves no credential', async () => {
    listAdAccounts.mockResolvedValue([]);
    const res = await callback().expect(302);
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(flag(res, 'meta_error')).toBe('incomplete_connection');
    expect(await listConnections(WS)).toEqual([]);
    expect(await listActiveSyncable(WS)).toEqual([]);
    expect(await runConnectorSync(WS)).toMatchObject({ synced: 0, results: [] });
    expect(await store.sql`SELECT workspace_id, account_id FROM marcom_credentials`).toEqual([]);
  });
  it('reconciliation failure rolls back the new link; retry retains one active authority', async () => {
    await store.sql`INSERT INTO users ("clerkId", "workspaceId", "collabRole") VALUES ('other', ${WS}, 'STRATEGIST')`;
    await store.sql`INSERT INTO marcom_projects VALUES ('old', 'other')`;
    await saveCredential('other', { projectId: 'old', platform: 'meta_ads', accessToken: 'old-token', accountId: 'old-account' });
    await attachWorkspaceToCredential({ projectId: 'old', userId: 'other', platform: 'meta_ads', workspaceId: WS });
    await store.sql.unsafe(`CREATE OR REPLACE FUNCTION fail_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_active = false THEN RAISE EXCEPTION 'private DB detail'; END IF; RETURN NEW; END $$`);
    await store.sql.unsafe(`CREATE TRIGGER fail_reconcile BEFORE UPDATE ON marcom_credentials FOR EACH ROW EXECUTE FUNCTION fail_deactivation()`);
    const failed = await callback().expect(302);
    expect(flag(failed, 'meta_connected')).toBeNull();
    expect(flag(failed, 'meta_error')).toBe('server_error');
    expect(await store.sql`SELECT id FROM marcom_credentials WHERE project_id = 'p1'`).toHaveLength(0);
    // A prior valid connection is preserved; it is not confused with this failed attempt.
    expect(await resolveCredential(WS, 'META')).toMatchObject({ accessToken: 'old-token', accountId: 'old-account' });
    expect((await listActiveSyncable(WS)).map((r) => r.accountId)).toEqual(['old-account']);
    await store.sql`DROP TRIGGER fail_reconcile ON marcom_credentials`;
    expect(flag(await callback().expect(302), 'meta_connected')).toBe('1');
    const [committed] = await store.sql`SELECT id FROM marcom_credentials WHERE project_id = 'p1'`;
    expect(flag(await callback().expect(302), 'meta_connected')).toBe('1');
    expect((await store.sql`SELECT id FROM marcom_credentials WHERE project_id = 'p1'`)[0].id).toBe(committed.id);
    expect((await listActiveSyncable(WS)).map((r) => r.accountId)).toEqual(['act1']);
    expect((await store.sql`SELECT id FROM marcom_credentials`)).toHaveLength(2);
  });
});
