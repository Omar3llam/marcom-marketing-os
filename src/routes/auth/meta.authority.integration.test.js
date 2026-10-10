// PILOT-SEC-02: real isolated PostgreSQL, actual routes/writers, provider/Firebase mocks.
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../../tests/dbProbe.js';

const control = vi.hoisted(() => ({ sql: null, gate: null, preLockGate: null, onQuery: null, writes: 0, audit: vi.fn(), firebaseDelete: vi.fn() }));
vi.mock('../../utils/db.js', () => ({ getDb: () => control.sql }));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/firebaseAuth.js', () => ({ requireAuth: (req, res, next) => req.user?.uid ? next() : res.status(401).json({ error: 'Unauthenticated' }) }));
vi.mock('../../utils/firebaseAdmin.js', () => ({ requireFirebaseAdminReady: () => ({ auth: () => ({ deleteUser: control.firebaseDelete }) }) }));
vi.mock('../../lib/adminAudit.js', () => ({ recordAdminAction: control.audit }));
vi.mock('../campaigns/context.js', () => ({ workspaceColumnsFromContext: () => ({}) }));
vi.mock('../../../prisma/seed.js', () => ({ seedDemoWorkspace: vi.fn() }));
vi.mock('../../services/metaAdsService.js', () => ({
  exchangeForLongLivedToken: vi.fn(async () => ({ accessToken: 'fixture-new-token', expiresAt: null })),
  listAdAccounts: vi.fn(async () => [{ id: 'act_fixture_new', accountStatus: 1 }]),
}));
vi.mock('../../services/connectors/credentialStore.js', async (original) => {
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

import { prisma } from '../../lib/prisma.js';
import { authMetaRouter, buildState } from './meta.js';
import { authGoogleRouter, buildState as buildGoogleState } from './google.js';
import { workspacesRouter } from '../admin/workspaces.js';
import { demoRouter } from '../admin/demo.js';
import { userRouter } from '../user.js';
import { credentialsRouter } from '../credentials.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';
import { exchangeForLongLivedToken } from '../../services/metaAdsService.js';
import { ensureCredentialSchema, saveCredential, getCredential } from '../../models/credential.js';
import { ensureProjectSchema, createProject } from '../../models/project.js';
import { attachWorkspaceToCredential, resolveCredential, upsertWorkspaceCredential } from '../../services/connectors/credentialStore.js';

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

describe.skipIf(!DB_OK)('Meta OAuth authority and lifecycle — real PostgreSQL', () => {
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

  it.each(['BUYER', 'CLIENT', null])('denies fresh %s at initiation despite cached STRATEGIST', async (role) => {
    const f = await fixture(role);
    control.writes = 0;
    const res = await request(appFor(f)).get('/api/auth/meta/connect').query({ projectId: f.projectId });
    expect(res.status).toBe(403);
    expect(res.body.oauthUrl).toBeUndefined();
  });
  it.each(['BUYER', 'CLIENT', null])('denies callback credential writes for current %s', async (role) => {
    const f = await fixture(role);
    const res = await callback(appFor(f), stateFor(f)).expect(302);
    const observed = await trace(`unauthorized-${role}`, f);
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(observed.projectRows).toBe(0);
    expect(control.writes).toBe(0);
  });
  it('rolls back the first save when active-source reconciliation fails', async () => {
    const f = await fixture();
    const oldProject = `${f.projectId}-old`;
    await createProject(f.user.clerkId, { projectId: oldProject, name: 'Old', context: 'Fixture' });
    fixtures.push({ ...f, projectId: oldProject });
    await saveCredential(f.user.clerkId, { projectId: oldProject, platform: 'meta_ads', accessToken: 'fixture-old', accountId: 'act_old' });
    await attachWorkspaceToCredential({ projectId: oldProject, userId: f.user.clerkId, platform: 'meta_ads', workspaceId: f.ws.id });
    await control.sql`CREATE OR REPLACE FUNCTION security_fail_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_active = false THEN RAISE EXCEPTION 'fixture reconciliation failure'; END IF; RETURN NEW; END $$`;
    await control.sql`CREATE TRIGGER security_fail_reconcile BEFORE UPDATE ON marcom_credentials FOR EACH ROW EXECUTE FUNCTION security_fail_reconcile()`;
    try {
      const res = await callback(appFor(f), stateFor(f)).expect(302);
      const observed = await trace('failed-reconciliation', f);
      expect(flag(res, 'meta_connected')).toBeNull();
      expect(observed.projectRows).toBe(0);
      expect(await resolveCredential(f.ws.id, 'META')).toMatchObject({ accountId: 'act_old' });
    } finally { await control.sql`DROP TRIGGER security_fail_reconcile ON marcom_credentials`; }
  });

  it.each(['admin', 'sole-member'])('serializes %s deletion with callback arriving after purge', async (kind) => {
    const f = await fixture();
    const app = appFor(f);
    const state = stateFor(f);
    const entered = deferred(), release = deferred();
    control.gate = { entered: entered.resolve, release: release.promise };
    const deleting = (kind === 'admin'
      ? request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name })
      : request(app).delete('/api/user/account')).then((r) => r);
    await entered.promise;
    let callbackDone = false;
    const connecting = callback(app, state).then((r) => { callbackDone = true; return r; });
    // Observe either old behavior (callback completes in the gap) or actual row-lock waiting.
    let blocked = false;
    try {
      const deadline = Date.now() + 2000;
      while (!callbackDone && !blocked && Date.now() < deadline) {
        const waiting = await control.sql`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%workspaces%'`;
        blocked = waiting.some((r) => r.blockers.length > 0);
        if (!blocked && !callbackDone) await new Promise((r) => setTimeout(r, 10));
      }
      console.log('PILOT_SEC02_ORDER', JSON.stringify({ kind, callbackCompletedBetweenPurgeAndDelete: callbackDone, callbackWaitedOnWorkspaceLock: blocked }));
    } finally { release.resolve(); control.gate = null; }
    const [deleted, connected] = await Promise.all([deleting, connecting]);
    expect(deleted.status).toBe(200);
    const observed = await trace(`${kind}-purge-callback-delete`, f);
    expect(observed.workspace).toBe(0);
    expect(observed.rows).toHaveLength(0);
    expect(flag(connected, 'meta_connected')).toBeNull();
    expect(await resolveCredential(foreign.ws.id, 'META')).toMatchObject({ accountId: 'act_foreign' });
  }, 15000);

  it('disables deletion of a seeded-style demo without immutable designation', async () => {
    const f = await fixture('STRATEGIST', 'Demo — Fixture');
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-demo', accountId: 'act_demo' });
    await attachWorkspaceToCredential({ projectId: f.projectId, userId: f.user.clerkId, platform: 'meta_ads', workspaceId: f.ws.id });
    const res = await request(appFor(f)).delete(`/api/admin/demo/${f.ws.id}`);
    const observed = await trace('demo-delete', f);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DemoDeletionUnavailable');
    expect(observed.workspace).toBe(1);
    expect(observed.rows).toHaveLength(1);
    expect(control.audit).not.toHaveBeenCalled();
  });
  it('does not accept mutable Demo prefix as authority to delete a connected real workspace', async () => {
    const f = await fixture();
    const app = appFor(f);
    expect(flag(await callback(app, stateFor(f)), 'meta_connected')).toBe('1');
    await request(app).patch('/api/user/workspace').send({ workspaceName: 'Demo — Renamed real fixture' }).expect(200);
    const res = await request(app).delete(`/api/admin/demo/${f.ws.id}`);
    const observed = await trace('renamed-real-demo-delete', f);
    expect(res.status).toBe(409);
    expect(observed.workspace).toBe(1);
    expect(observed.rows).toHaveLength(1);
    expect(control.audit).not.toHaveBeenCalled();
  });
  it('preserves authorized encrypted completion and foreign-workspace isolation', async () => {
    const f = await fixture();
    const res = await callback(appFor(f), stateFor(f)).expect(302);
    expect(flag(res, 'meta_connected')).toBe('1');
    expect(await resolveCredential(f.ws.id, 'META')).toMatchObject({ accountId: 'act_fixture_new' });
    const [stored] = await control.sql`SELECT access_token_enc FROM marcom_credentials WHERE project_id = ${f.projectId}`;
    expect(stored.access_token_enc).not.toContain('fixture-new-token');
    expect(await resolveCredential(foreign.ws.id, 'META')).toMatchObject({ accountId: 'act_foreign' });
  });

  it.each(['demotion', 'removed user', 'moved membership', 'foreign project', 'foreign credential'])('refuses %s without any credential write', async (change) => {
    const f = await fixture();
    let state = stateFor(f);
    if (change === 'demotion') await prisma.user.update({ where: { id: f.user.id }, data: { collabRole: 'CLIENT' } });
    if (change === 'removed user') await prisma.user.delete({ where: { id: f.user.id } });
    if (change === 'moved membership') await prisma.user.update({ where: { id: f.user.id }, data: { workspaceId: foreign.ws.id } });
    if (change === 'foreign project') state = buildState(f.user.clerkId, foreign.projectId, '/onboarding', f.ws.id);
    if (change === 'foreign credential') {
      const linked = await fixture();
      await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-linked', accountId: 'act_linked' });
      await attachWorkspaceToCredential({ projectId: f.projectId, userId: f.user.clerkId, platform: 'meta_ads', workspaceId: linked.ws.id });
    }
    control.writes = 0;
    const res = await callback(appFor(f), state).expect(302);
    expect(flag(res, 'meta_connected')).toBeNull();
    expect(control.writes).toBe(0);
  });

  it('rechecks demotion during provider exchange before the first write', async () => {
    const f = await fixture();
    exchangeForLongLivedToken.mockImplementationOnce(async () => {
      await prisma.user.update({ where: { id: f.user.id }, data: { collabRole: 'BUYER' } });
      return { accessToken: 'fixture-new-token', expiresAt: null };
    });
    control.writes = 0;
    const res = await callback(appFor(f), stateFor(f));
    expect(flag(res, 'meta_error')).toBe('role_forbidden');
    expect(control.writes).toBe(0);
  });

  it.each(['admin', 'sole-member'])('callback holding authority lock precedes %s deletion without orphan', async (kind) => {
    const f = await fixture(), app = appFor(f);
    const gate = pauseAfterUserLock(f);
    const connecting = callback(app, stateFor(f)).then((r) => r);
    await gate.entered;
    const deleting = (kind === 'admin'
      ? request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name })
      : request(app).delete('/api/user/account')).then((r) => r);
    try { expect(await observeBlocked('workspaces')).toBe(true); }
    finally { gate.release(); }
    const [, deleted] = await Promise.all([connecting, deleting]);
    expect(deleted.status).toBe(200);
    const observed = await trace(`${kind}-callback-first`, f);
    expect(observed.workspace).toBe(0); expect(observed.rows).toHaveLength(0);
  }, 15000);

  it('orders current role update after a callback holding the user lock', async () => {
    const f = await fixture(), gate = pauseAfterUserLock(f);
    const connecting = callback(appFor(f), stateFor(f)).then((r) => r);
    await gate.entered;
    const demoting = prisma.user.update({ where: { id: f.user.id }, data: { collabRole: 'CLIENT' } }).then((r) => r);
    try { expect(await observeBlocked('users')).toBe(true); }
    finally { gate.release(); }
    const [connected] = await Promise.all([connecting, demoting]);
    expect(flag(connected, 'meta_connected')).toBe('1');
    control.onQuery = null; control.writes = 0;
    expect(flag(await callback(appFor(f), stateFor(f)), 'meta_error')).toBe('role_forbidden');
    expect(control.writes).toBe(0);
  }, 15000);

  it('serializes two competing callback replacements to one active source', async () => {
    const f = await fixture(), second = { ...f, projectId: `${f.projectId}-second` };
    fixtures.push(second);
    await createProject(f.user.clerkId, { projectId: second.projectId, name: 'Second', context: 'Fixture' });
    const gate = pauseAfterUserLock(f);
    const first = callback(appFor(f), stateFor(f)).then((r) => r);
    await gate.entered;
    const competing = callback(appFor(second), stateFor(second)).then((r) => r);
    try { expect(await observeBlocked('workspaces')).toBe(true); }
    finally { gate.release(); }
    await Promise.all([first, competing]);
    const rows = await credentialRows(f.ws.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_active)).toHaveLength(1);
    expect(await resolveCredential(foreign.ws.id, 'META')).toMatchObject({ accountId: 'act_foreign' });
  }, 15000);

  it.each(['purge', 'workspace delete'])('rolls back admin deletion on %s failure', async (failure) => {
    const f = await fixture(), app = appFor(f);
    await callback(app, stateFor(f)).expect(302);
    const table = failure === 'purge' ? 'marcom_credentials' : 'workspaces';
    await control.sql`CREATE OR REPLACE FUNCTION security_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture deletion failure'; END $$`;
    // Only these two fixed fixture-table identifiers enter the trigger DDL.
    const raw = postgres(process.env.DATABASE_URL, { max: 1 });
    try {
      await raw.unsafe(`CREATE TRIGGER security_fail_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION security_fail_delete()`);
      const res = await request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name });
      expect(res.status).toBe(500);
      const observed = await trace(`rollback-${failure}`, f);
      expect(observed.workspace).toBe(1); expect(observed.rows).toHaveLength(1);
      expect(observed.rows[0].is_active).toBe(true); expect(control.audit).not.toHaveBeenCalled();
    } finally {
      await raw.unsafe(`DROP TRIGGER IF EXISTS security_fail_delete ON ${table}`);
      await raw`DROP FUNCTION security_fail_delete()`; await raw.end();
    }
  });

  it('rechecks a second member before deciding whether account deletion can cascade', async () => {
    const f = await fixture();
    const entered = deferred(), release = deferred();
    control.preLockGate = { entered: entered.resolve, release: release.promise };
    const deleting = request(appFor(f)).delete('/api/user/account').then((r) => r);
    await entered.promise; // Initial user lookup has completed; transaction has not locked yet.
    await prisma.user.create({ data: { workspaceId: f.ws.id, email: `${randomUUID()}@example.invalid`, collabRole: 'STRATEGIST' } });
    release.resolve(); control.preLockGate = null;
    expect((await deleting).status).toBe(200);
    expect(await prisma.workspace.count({ where: { id: f.ws.id } })).toBe(1);
    expect(await prisma.user.count({ where: { workspaceId: f.ws.id } })).toBe(1);
    expect(control.firebaseDelete).toHaveBeenCalledWith(f.user.clerkId);
  });
  it('a real workspace lock timeout fails closed and preserves existing credentials', async () => {
    const f = await fixture(), app = appFor(f);
    await callback(app, stateFor(f)).expect(302);
    const entered = deferred(), release = deferred();
    const holding = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${f.ws.id}::uuid FOR UPDATE`;
      entered.resolve(); await release.promise;
    });
    await entered.promise;
    const begin = control.sql.begin;
    control.sql.begin = (operation) => begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '100ms'`;
      return operation(tx);
    });
    try {
      control.writes = 0;
      const res = await callback(app, stateFor(f)).expect(302);
      expect(flag(res, 'meta_error')).toBe('authority_unavailable');
      expect(control.writes).toBe(0);
      expect((await credentialRows(f.ws.id)).filter((r) => r.is_active)).toHaveLength(1);
    } finally { control.sql.begin = begin; release.resolve(); await holding; }
  }, 15000);

  // Independent-review acceptance cases retained unchanged through R2.
  it('residual acceptance: uppercase UUID deletion purges canonical credential keys', async () => {
    const f = await fixture();
    await callback(appFor(f), stateFor(f)).expect(302);
    expect(f.ws.id.toUpperCase()).not.toBe(f.ws.id);
    await request(appFor(f)).delete(`/api/admin/workspaces/${f.ws.id.toUpperCase()}`).send({ confirmName: f.ws.name }).expect(200);
    const observed = await trace('residual-uppercase-purge', f);
    expect(observed.workspace).toBe(0);
    expect(observed.rows).toHaveLength(0);
  });
  it('residual acceptance: uppercase UUID preserves self-workspace refusal', async () => {
    const f = await fixture();
    const res = await request(appFor(f, 'ADMIN', f.ws.id)).delete(`/api/admin/workspaces/${f.ws.id.toUpperCase()}`).send({ confirmName: f.ws.name });
    await trace('residual-uppercase-self', f);
    expect(res.status).toBe(409);
    expect(await prisma.workspace.count({ where: { id: f.ws.id } })).toBe(1);
  });
  it.each(['admin', 'sole-member'])('residual acceptance: %s deletion purges unstamped legacy project credentials', async (kind) => {
    const f = await fixture(), app = appFor(f);
    await saveCredential(f.user.clerkId, { projectId: f.projectId, platform: 'meta_ads', accessToken: 'fixture-legacy', accountId: 'act_legacy' });
    const [before] = await control.sql`SELECT workspace_id, is_active FROM marcom_credentials WHERE project_id = ${f.projectId}`;
    expect(before.workspace_id).toBeNull(); expect(before.is_active).toBe(true);
    const deleted = kind === 'admin'
      ? await request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name })
      : await request(app).delete('/api/user/account');
    expect(deleted.status).toBe(200);
    const observed = await trace(`residual-${kind}-legacy`, f);
    expect(observed.workspace).toBe(0);
    expect(observed.projectRows).toBe(0);
  });
  it.each(['admin', 'sole-member'])('residual acceptance: pending Google callback cannot recreate credentials after %s deletion', async (kind) => {
    const f = await fixture(), app = appFor(f);
    const entered = deferred(), release = deferred();
    const state = buildGoogleState(f.ws.id, f.user.clerkId);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        entered.resolve(); await release.promise;
        return { ok: true, json: async () => ({ access_token: 'fixture-google', refresh_token: 'fixture-google-refresh' }) };
      }
      return { ok: true, json: async () => ({ resourceNames: ['customers/123456789'] }) };
    }));
    const connecting = request(app).get('/api/auth/google/callback').query({ code: 'fixture-code', state }).then((r) => r);
    await entered.promise;
    try {
      const deleted = kind === 'admin'
        ? await request(app).delete(`/api/admin/workspaces/${f.ws.id}`).send({ confirmName: f.ws.name })
        : await request(app).delete('/api/user/account');
      expect(deleted.status).toBe(200);
    } finally { release.resolve(); }
    const connected = await connecting;
    const observed = await trace(`residual-${kind}-late-google`, f);
    console.log('PILOT_SEC02_RESIDUAL', JSON.stringify({ kind, googleConnected: flag(connected, 'google_connected') }));
    expect(observed.workspace).toBe(0);
    expect(observed.rows).toHaveLength(0);
  }, 15000);

});
