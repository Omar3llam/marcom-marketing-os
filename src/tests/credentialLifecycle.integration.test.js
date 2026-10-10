// PILOT-SEC-02: real isolated PostgreSQL, actual routes/writers, provider/Firebase mocks.
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../tests/dbProbe.js';

const control = vi.hoisted(() => ({ sql: null, gate: null, preLockGate: null, onQuery: null, writes: 0, audit: vi.fn(), firebaseDelete: vi.fn() }));
vi.mock('../utils/db.js', () => ({ getDb: () => control.sql }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware/firebaseAuth.js', () => ({ requireAuth: (req, res, next) => req.user?.uid ? next() : res.status(401).json({ error: 'Unauthenticated' }) }));
vi.mock('../utils/firebaseAdmin.js', () => ({ requireFirebaseAdminReady: () => ({ auth: () => ({ deleteUser: control.firebaseDelete }) }) }));
vi.mock('../lib/adminAudit.js', () => ({ recordAdminAction: control.audit }));
vi.mock('../routes/campaigns/context.js', () => ({ workspaceColumnsFromContext: () => ({}) }));
vi.mock('../../prisma/seed.js', () => ({ seedDemoWorkspace: vi.fn() }));
vi.mock('../services/metaAdsService.js', () => ({
  exchangeForLongLivedToken: vi.fn(async () => ({ accessToken: 'fixture-new-token', expiresAt: null })),
  listAdAccounts: vi.fn(async () => [{ id: 'act_fixture_new', accountStatus: 1 }]),
}));
vi.mock('../services/connectors/credentialStore.js', async (original) => {
  const store = await original();
  return { ...store, withWorkspaceCredentialTransaction: async (...args) => {
    if (control.preLockGate) { control.preLockGate.entered(); await control.preLockGate.release; }
    return store.withWorkspaceCredentialTransaction(...args);
  }, deleteWorkspaceCredentials: async (...args) => {
    const count = await store.deleteWorkspaceCredentials(...args);
    if (control.gate) { control.gate.entered(); await control.gate.release; }
    return count;
  } };
});

import { prisma } from '../lib/prisma.js';
import { authMetaRouter, buildState } from '../routes/auth/meta.js';
import { authGoogleRouter, buildState as buildGoogleState } from '../routes/auth/google.js';
import { workspacesRouter } from '../routes/admin/workspaces.js';
import { demoRouter } from '../routes/admin/demo.js';
import { userRouter } from '../routes/user.js';
import { credentialsRouter } from '../routes/credentials.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { exchangeForLongLivedToken } from '../services/metaAdsService.js';
import { ensureCredentialSchema, saveCredential, getCredential } from '../models/credential.js';
import { ensureProjectSchema, createProject } from '../models/project.js';
import { attachWorkspaceToCredential, resolveCredential, upsertWorkspaceCredential } from '../services/connectors/credentialStore.js';

const DB_OK = await dbAvailable();
let foreign, fixtures = [];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function observedSql(sql) {
  const wrapped = async (strings, ...values) => {
    const query = strings.join(' ');
    if (/^\s*(INSERT INTO|UPDATE) marcom_credentials/.test(query)) control.writes++;
    const result = await sql(strings, ...values);
    if (control.onQuery) await control.onQuery(query, values);
    return result;
  };
  wrapped.json = sql.json.bind(sql);
  wrapped.begin = (operation) => sql.begin((tx) => operation(observedSql(tx)));
  if (typeof sql.end === 'function') wrapped.end = sql.end.bind(sql);
  return wrapped;
}

function pauseAfterUserLock(f) {
  const entered = deferred(), release = deferred();
  let paused = false;
  control.onQuery = async (query, values) => {
    if (!paused && query.includes('FROM users') && query.includes('FOR UPDATE') && values.includes(f.user.clerkId)) {
      paused = true; entered.resolve(); await release.promise;
    }
  };
  return { entered: entered.promise, release: release.resolve };
}

async function observeBlocked(table) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const rows = await control.sql`SELECT pid, pg_blocking_pids(pid) AS blockers, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    const blocked = rows.find((r) => r.query.includes(table) && r.blockers.length);
    if (blocked) { console.log('PILOT_SEC02_LOCK', JSON.stringify({ table, pid: blocked.pid, blockers: blocked.blockers })); return true; }
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function fixture(role = 'STRATEGIST', name = 'Security fixture') {
  const key = randomUUID();
  const ws = await prisma.workspace.create({ data: { name: `${name} ${key}` } });
  const user = await prisma.user.create({ data: { workspaceId: ws.id, clerkId: `fixture-${key}`, email: `${key}@example.invalid`, collabRole: role } });
  const projectId = `project-${key}`;
  await createProject(user.clerkId, { projectId, name: 'Fixture', context: 'Isolated security test' });
  const f = { ws, user, projectId };
  fixtures.push(f);
  return f;
}

function appFor(f, adminRole = 'ADMIN', adminWorkspaceId = foreign.ws.id) {
  const app = express().use(express.json()).use((req, _res, next) => {
    const admin = req.path.startsWith('/api/admin');
    req.user = { uid: admin ? 'fixture-admin' : f.user.clerkId, email: 'fixture@example.invalid' };
    req.userId = req.user.uid;
    req.userRole = admin ? adminRole : 'VIEWER';
    req.workspaceId = admin ? adminWorkspaceId : f.ws.id;
    req.collabRole = 'STRATEGIST'; // Intentionally stale: the database must win.
    next();
  });
  app.use('/api/auth/meta', authMetaRouter);
  app.use('/api/auth/google', authGoogleRouter);
  app.use('/api/user', userRouter);
  app.use('/api/credentials', credentialsRouter);
  app.use('/api/admin/workspaces', requireAdmin, workspacesRouter);
  app.use('/api/admin/demo', requireAdmin, demoRouter);
  return app;
}

const stateFor = (f) => buildState(f.user.clerkId, f.projectId, '/onboarding?step=connect', f.ws.id);
const callback = (app, state) => request(app).get('/api/auth/meta/callback').query({ code: 'fixture-code', state });
const flag = (res, name) => new URL(res.headers.location, 'http://localhost').searchParams.get(name);
async function credentialRows(wsId) { return control.sql`SELECT id, project_id, workspace_id, is_active, account_id FROM marcom_credentials WHERE workspace_id = ${wsId}`; }
async function trace(label, f) {
  const rows = await credentialRows(f.ws.id);
  const unbound = await control.sql`SELECT count(*)::int AS n FROM marcom_credentials WHERE project_id = ${f.projectId}`;
  const workspace = await prisma.workspace.count({ where: { id: f.ws.id } });
  console.log('PILOT_SEC02_DB', JSON.stringify({ label, workspaceRows: workspace, credentialRows: rows.length, activeRows: rows.filter((r) => r.is_active).length, projectCredentialRows: unbound[0].n }));
  return { rows, workspace, projectRows: unbound[0].n };
}

describe.skipIf(!DB_OK)('R2 shared credential lifecycle — real PostgreSQL', () => {
  beforeAll(async () => {
    control.sql = observedSql(postgres(process.env.DATABASE_URL, { max: 4 }));
    vi.stubEnv('OAUTH_STATE_SECRET', 'fixture-signing-key');
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'b'.repeat(64));
    vi.stubEnv('META_APP_ID', 'fixture-app');
    await ensureCredentialSchema();
    await ensureProjectSchema();
    foreign = await fixture();
    await saveCredential(foreign.user.clerkId, { projectId: foreign.projectId, platform: 'meta_ads', accessToken: 'fixture-foreign', accountId: 'act_foreign' });
    await attachWorkspaceToCredential({ projectId: foreign.projectId, userId: foreign.user.clerkId, platform: 'meta_ads', workspaceId: foreign.ws.id });
    const [raw] = await control.sql`SELECT current_database() AS db, pg_backend_pid() AS pid`;
    const [orm] = await prisma.$queryRaw`SELECT current_database() AS db, pg_backend_pid() AS pid`;
    expect(raw.db).toBe(orm.db);
    expect(raw.pid).not.toBe(orm.pid);
    console.log('PILOT_SEC02_DB_CLIENTS', JSON.stringify({ database: raw.db, rawPid: raw.pid, prismaPid: orm.pid }));
  });
  beforeEach(() => {
    control.gate = null;
    control.preLockGate = null;
    control.onQuery = null; control.writes = 0;
    control.audit.mockClear();
    control.firebaseDelete.mockClear();
    exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'fixture-new-token', expiresAt: null });
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ access_token: 'fixture-short-token' }) })));
  });
  afterAll(async () => {
    if (control.sql) {
      await control.sql`DROP TRIGGER IF EXISTS security_fail_reconcile ON marcom_credentials`;
      await control.sql`DROP FUNCTION IF EXISTS security_fail_reconcile()`;
      for (const f of fixtures) {
        await control.sql`DELETE FROM marcom_credentials WHERE workspace_id = ${f.ws.id} OR project_id = ${f.projectId}`;
        await control.sql`DELETE FROM marcom_projects WHERE project_id = ${f.projectId}`;
        await prisma.workspace.deleteMany({ where: { id: f.ws.id } });
      }
      await control.sql.end();
    }
    await prisma.$disconnect();
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });

  it('R2 preserves legitimate manual route, encryption, optional fields and return shape', async () => {
    const f = await fixture();
    const res = await request(appFor(f)).post('/api/credentials').send({ project_id: f.projectId, platform: 'meta_ads', access_token: 'fixture-manual', refresh_token: 'fixture-refresh', account_id: 'act_manual', scopes: 'read', expires_at: '2030-01-01T00:00:00.000Z' }).expect(200);
    expect(res.body.credential).toMatchObject({ projectId: f.projectId, platform: 'meta_ads', accountId: 'act_manual', scopes: 'read' });
    expect(res.body.credential).not.toHaveProperty('accessToken');
    expect(res.body.credential).not.toHaveProperty('refreshToken');
    const first = await getCredential(f.user.clerkId, f.projectId, 'meta_ads');
    expect(first).toMatchObject({ accessToken: 'fixture-manual', refreshToken: 'fixture-refresh' });
    const updated = await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads' });
    expect(updated).toMatchObject({ id: first.id, accessToken: null, refreshToken: null, accountId: 'act_manual', scopes: 'read', expiresAt: new Date('2030-01-01') });
    const [stored] = await control.sql`SELECT workspace_id FROM marcom_credentials WHERE project_id = ${f.projectId}`;
    expect(stored.workspace_id).toBeNull(); // Preserve the project-keyed manual representation.
  });
  it.each(['purge', 'workspace delete'])('R2 rolls back sole-member deletion on %s failure before Firebase cleanup', async (failure) => {
    const f = await fixture();
    await callback(appFor(f), stateFor(f)).expect(302);
    const table = failure === 'purge' ? 'marcom_credentials' : 'workspaces';
    const raw = postgres(process.env.DATABASE_URL, { max: 1 });
    await raw`CREATE OR REPLACE FUNCTION security_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture deletion failure'; END $$`;
    try {
      await raw.unsafe(`CREATE TRIGGER security_fail_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION security_fail_delete()`);
      await request(appFor(f)).delete('/api/user/account').expect(500);
      const observed = await trace(`sole-rollback-${failure}`, f);
      expect(observed.workspace).toBe(1); expect(observed.rows).toHaveLength(1); expect(observed.rows[0].is_active).toBe(true);
      expect(control.firebaseDelete).not.toHaveBeenCalled();
    } finally {
      await raw.unsafe(`DROP TRIGGER IF EXISTS security_fail_delete ON ${table}`);
      await raw`DROP FUNCTION security_fail_delete()`; await raw.end();
    }
  });
  it.each(['admin', 'sole-member'])('R2 refuses manual persistence after %s workspace removal', async (kind) => {
    const f = await fixture(), app = appFor(f);
    const deleted = kind === 'admin' ? await request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }) : await request(app).delete('/api/user/account');
    expect(deleted.status).toBe(200); control.writes = 0;
    await expect(saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-late' })).rejects.toThrow(/lifecycle/);
    expect(control.writes).toBe(0);
    expect((await trace(`manual-after-${kind}`, f)).projectRows).toBe(0);
  });
  it('R2 refuses manual persistence after owner removal while workspace survives', async () => {
    const f = await fixture();
    await prisma.user.delete({ where: { id: f.user.id } }); control.writes = 0;
    await expect(saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-late' })).rejects.toThrow(/lifecycle/);
    expect(control.writes).toBe(0); expect((await trace('manual-removed-owner', f)).workspace).toBe(1);
  });
  it('R2 rejects unverifiable project and foreign credential ownership without writes', async () => {
    const f = await fixture();
    control.writes = 0;
    await expect(saveCredential(f.user.clerkId, { projectId: foreign.projectId, platform: 'meta_ads', accessToken: 'fixture-denied' })).rejects.toThrow(/lifecycle/);
    await control.sql`INSERT INTO marcom_credentials (project_id, user_id, platform) VALUES (${f.projectId}, ${foreign.user.clerkId}, 'meta_ads')`;
    control.writes = 0;
    await expect(saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-denied' })).rejects.toThrow(/lifecycle/);
    expect(control.writes).toBe(0);
    expect(await resolveCredential(foreign.ws.id, 'META')).toMatchObject({ accountId: 'act_foreign' });
  });
  it('R2 serializes manual-first persistence with deletion and purges the legacy row', async () => {
    const f = await fixture(), gate = pauseAfterUserLock(f);
    const saving = saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-manual' });
    await gate.entered;
    const deleting = request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).then((r) => r);
    try { expect(await observeBlocked('workspaces')).toBe(true); } finally { gate.release(); }
    const [, deleted] = await Promise.all([saving, deleting]);
    expect(deleted.status).toBe(200);
    expect((await trace('manual-first-delete', f)).projectRows).toBe(0);
  }, 15000);
  it('R2 refuses manual write waiting behind a deleting workspace', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    control.gate = { entered: entered.resolve, release: release.promise };
    const deleting = request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).then((r) => r);
    await entered.promise;
    const saving = saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-manual' }).then(() => 'saved', () => 'refused');
    try { expect(await observeBlocked('workspaces')).toBe(true); } finally { release.resolve(); control.gate = null; }
    const [deleted, saved] = await Promise.all([deleting, saving]);
    expect(deleted.status).toBe(200); expect(saved).toBe('refused');
    expect((await trace('delete-first-manual', f)).projectRows).toBe(0);
  }, 15000);
  it('R2 preserves legitimate Google protocol and canonical workspace identity', async () => {
    const f = await fixture('BUYER'); // Lifecycle coordination adds no Google role policy.
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'fixture-google-app');
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => url.includes('/token') ? { access_token: 'fixture-google', refresh_token: 'fixture-refresh' } : { resourceNames: ['customers/123456789'] } })));
    const app = appFor(f);
    const start = await request(app).get('/api/auth/google/connect').expect(200);
    const state = new URL(start.body.oauthUrl).searchParams.get('state');
    expect(flag(await request(app).get('/api/auth/google/callback').query({ code: 'fixture-code', state }).expect(302), 'google_connected')).toBe('1');
    expect(await resolveCredential(f.ws.id, 'GOOGLE')).toMatchObject({ accessToken: 'fixture-google', refreshToken: 'fixture-refresh', accountId: '123456789' });
    await upsertWorkspaceCredential(f.ws.id.toUpperCase(), 'GOOGLE', { userId: f.user.clerkId, accessToken: 'fixture-replaced' });
    expect(await resolveCredential(f.ws.id, 'GOOGLE')).toMatchObject({ accessToken: 'fixture-replaced', refreshToken: 'fixture-refresh', accountId: '123456789' });
    const rows = await credentialRows(f.ws.id); expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBe(f.ws.id);
  });
  it.each(['missing', 'foreign'])('R2 rejects %s Google identity association before persistence', async (kind) => {
    const f = await fixture(); control.writes = 0;
    await expect(upsertWorkspaceCredential(f.ws.id, 'GOOGLE', { userId: kind === 'missing' ? undefined : foreign.user.clerkId, accessToken: 'fixture-denied' })).rejects.toThrow(/lifecycle/);
    expect(control.writes).toBe(0); expect(await credentialRows(f.ws.id)).toHaveLength(0);
  });
  it('R2 serializes Google-first persistence with deletion', async () => {
    const f = await fixture(), gate = pauseAfterUserLock(f);
    const saving = upsertWorkspaceCredential(f.ws.id, 'GOOGLE', { userId: f.user.clerkId, accessToken: 'fixture-google' });
    await gate.entered;
    const deleting = request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).then((r) => r);
    try { expect(await observeBlocked('workspaces')).toBe(true); } finally { gate.release(); }
    const [, deleted] = await Promise.all([saving, deleting]);
    expect(deleted.status).toBe(200); expect((await trace('google-first-delete', f)).rows).toHaveLength(0);
  }, 15000);
  it('R2 orders competing Google replacements from two legitimate members', async () => {
    const f = await fixture(), gate = pauseAfterUserLock(f);
    const second = await prisma.user.create({ data: { workspaceId: f.ws.id, clerkId: `member-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, collabRole: 'CLIENT' } });
    const first = upsertWorkspaceCredential(f.ws.id, 'GOOGLE', { userId: f.user.clerkId, accessToken: 'fixture-first', refreshToken: 'fixture-refresh' });
    await gate.entered;
    const replacing = upsertWorkspaceCredential(f.ws.id, 'GOOGLE', { userId: second.clerkId, accessToken: 'fixture-second' });
    try { expect(await observeBlocked('workspaces')).toBe(true); } finally { gate.release(); }
    await Promise.all([first, replacing]);
    expect((await credentialRows(f.ws.id)).filter((r) => r.is_active)).toHaveLength(1);
    expect(await resolveCredential(f.ws.id, 'GOOGLE')).toMatchObject({ accessToken: 'fixture-second', refreshToken: 'fixture-refresh' });
  }, 15000);
  it('R2 rolls back Google replacement and preserves the prior active source on reconciliation failure', async () => {
    const f = await fixture();
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'google_ads', accessToken: 'fixture-old', accountId: 'old' });
    await attachWorkspaceToCredential({ projectId: f.projectId, userId: f.user.clerkId, platform: 'google_ads', workspaceId: f.ws.id });
    await control.sql`CREATE OR REPLACE FUNCTION security_fail_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_active = false THEN RAISE EXCEPTION 'fixture reconciliation failure'; END IF; RETURN NEW; END $$`;
    await control.sql`CREATE TRIGGER security_fail_reconcile BEFORE UPDATE ON marcom_credentials FOR EACH ROW EXECUTE FUNCTION security_fail_reconcile()`;
    try {
      await expect(upsertWorkspaceCredential(f.ws.id, 'GOOGLE', { userId: f.user.clerkId, accessToken: 'fixture-new' })).rejects.toThrow();
      expect(await resolveCredential(f.ws.id, 'GOOGLE')).toMatchObject({ accessToken: 'fixture-old', accountId: 'old' });
      expect(await credentialRows(f.ws.id)).toHaveLength(1);
    } finally { await control.sql`DROP TRIGGER security_fail_reconcile ON marcom_credentials`; }
  });
  it.each(['admin', 'sole-member'])('R2 refuses %s deletion when legacy project ownership is ambiguous', async (kind) => {
    const f = await fixture(), app = appFor(f);
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-legacy' });
    await control.sql`DELETE FROM marcom_projects WHERE project_id = ${f.projectId}`;
    const deleted = kind === 'admin' ? await request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }) : await request(app).delete('/api/user/account');
    expect(deleted.status).toBe(500); expect(control.audit).not.toHaveBeenCalled(); expect(control.firebaseDelete).not.toHaveBeenCalled();
    const observed = await trace(`ambiguous-legacy-${kind}`, f);
    expect(observed.workspace).toBe(1); expect(observed.projectRows).toBe(1);
  });
  it('R2 purges proven legacy ownership and preserves foreign unbound rows', async () => {
    const f = await fixture(), other = await fixture();
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-own' });
    const foreignRow = await saveCredential(other.user.clerkId, { projectId: other.projectId, platform: 'meta_ads', accessToken: 'fixture-other' });
    const deleted = await request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).expect(200);
    expect(deleted.body.credentialsDeleted).toBe(1);
    expect(await getCredential(other.user.clerkId, other.projectId, 'meta_ads')).toMatchObject({ id: foreignRow.id, accessToken: 'fixture-other' });
    expect((await trace('proven-legacy-only', f)).projectRows).toBe(0);
  });
  it('R2 revalidates current self-workspace membership despite stale request context', async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.user.id }, data: { clerkId: 'fixture-admin' } });
    const res = await request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name });
    expect(res.status).toBe(409); expect(await prisma.workspace.count({ where: { id: f.ws.id } })).toBe(1);
    await prisma.user.update({ where: { id: f.user.id }, data: { clerkId: f.user.clerkId } });
  });
  it('R2 never interprets a foreign owned project UUID as authority to purge its credential', async () => {
    const f = await fixture(), other = await fixture(), alias = { ...other, projectId: f.ws.id };
    fixtures.push(alias);
    await createProject(other.user.clerkId, { projectId: alias.projectId, name: 'Independent owned project', context: 'Fixture' });
    await saveCredential(other.user.clerkId, { projectId: alias.projectId, platform: 'meta_ads', accessToken: 'fixture-foreign' });
    await request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).expect(500);
    expect(await getCredential(other.user.clerkId, alias.projectId, 'meta_ads')).toMatchObject({ accessToken: 'fixture-foreign' });
    expect(await prisma.workspace.count({ where: { id: f.ws.id } })).toBe(1);
    expect(control.audit).not.toHaveBeenCalled();
  });
  it('R2 retains shared workspace credentials while removing a departing member’s proven private legacy rows', async () => {
    const f = await fixture();
    const member = await prisma.user.create({ data: { workspaceId: f.ws.id, clerkId: `member-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, collabRole: 'STRATEGIST' } });
    const remaining = { ...f, user: member, projectId: `${f.projectId}-remaining` }; fixtures.push(remaining);
    await createProject(member.clerkId, { projectId: remaining.projectId, name: 'Remaining member', context: 'Fixture' });
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-private' });
    await saveCredential(member.clerkId, { projectId: remaining.projectId, platform: 'meta_ads', accessToken: 'fixture-shared', accountId: 'shared' });
    await attachWorkspaceToCredential({ projectId: remaining.projectId, userId: member.clerkId, platform: 'meta_ads', workspaceId: f.ws.id });
    await request(appFor(f)).delete('/api/user/account').expect(200);
    const observed = await trace('departing-private-owner', f);
    expect(observed.workspace).toBe(1); expect(observed.rows).toHaveLength(1);
    expect(await resolveCredential(f.ws.id, 'META')).toMatchObject({ accessToken: 'fixture-shared' });
    expect(observed.projectRows).toBe(0);
    await request(appFor(remaining)).delete('/api/user/account').expect(200);
    expect((await trace('remaining-member-cascade', remaining)).rows).toHaveLength(0);
  });
  it('R2 missing legacy owner is not promoted into workspace authority by SQL NULL logic', async () => {
    const f = await fixture(), alias = { ...f, projectId: f.ws.id }; fixtures.push(alias);
    await createProject(f.user.clerkId, { projectId: alias.projectId, name: 'Historical key', context: 'Fixture' });
    await saveCredential(f.user.clerkId, { projectId: alias.projectId, platform: 'meta_ads', accessToken: 'fixture-unverifiable' });
    await prisma.user.delete({ where: { id: f.user.id } });
    await request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name }).expect(500);
    expect(await prisma.workspace.count({ where: { id: f.ws.id } })).toBe(1);
    expect(await getCredential(f.user.clerkId, alias.projectId, 'meta_ads')).toMatchObject({ accessToken: 'fixture-unverifiable' });
    expect(control.audit).not.toHaveBeenCalled();
  });
});
