import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectPrismaRuntimeRole, inspectPostgresRuntimeRole } from '../services/startup/runtimeRolePreflight.js';

const clone = value => structuredClone(value);
const identity = { login: 'lumi_backend_runtime', session: 'lumi_backend_runtime', major: 17,
  pid: 123, read_only: 'on', isolation: 'repeatable read', path: 'pg_catalog, pg_temp' };
const runtime = { name: 'lumi_backend_runtime', superuser: false, create_role: false, create_db: false,
  replication: false, bypass_rls: false, login: true, inherit: true, member: true, usage: true, settable: true, admin: true };
const app = { ...runtime, name: 'lumi_canonical_app', login: false, admin: false };
function fixture(driver, patch = {}) {
  const state = {
    identity: clone(identity), roles: [clone(runtime), clone(app)],
    memberships: [{ member: runtime.name, role: app.name, admin_option: false, inherit_option: true, set_option: true }],
    authority: { connect: true, create_db: false, temp: false, database_grant: false,
      schemas: 4, schema_create: 0, schema_grant: 0, owned_objects: 0, parameter_grants: 0, settings: 0 },
    ...patch,
  };
  const calls = [];
  let settled = false;
  const query = vi.fn(async (strings, ...values) => {
    const text = strings.join('?'); calls.push({ text, values });
    if (state.error) throw state.error;
    if (text.includes('set_config')) return [{}];
    if (text.includes('AS read_only')) return clone(state.identity ? [state.identity] : []);
    if (text.includes('AS superuser')) return clone(state.roles);
    if (text.includes('admin_option')) return clone(state.memberships);
    if (text.includes('AS owned_objects')) return clone(state.authority ? [state.authority] : []);
    throw Error('unexpected query');
  });
  const execute = vi.fn(async strings => { calls.push({ text: strings.join('') }); return 0; });
  const tx = driver === 'PRISMA' ? { $queryRaw: query, $executeRaw: execute } : query;
  const transaction = vi.fn(async (...args) => {
    const callback = driver === 'PRISMA' ? args[0] : args[1];
    try {
      const value = await callback(tx);
      if (state.finishError) throw state.finishError;
      return value;
    } finally { settled = true; }
  });
  const client = driver === 'PRISMA' ? { $transaction: transaction } : Object.assign(() => {}, { begin: transaction });
  const run = () => (driver === 'PRISMA' ? inspectPrismaRuntimeRole : inspectPostgresRuntimeRole)(client);
  return { state, calls, query, execute, transaction, run, settled: () => settled };
}
const scope = { scope: 'RUNTIME_ROLE_CAPABILITIES_ONLY', runtimeAdmission: 'NOT_WIRED',
  physicalTarget: 'UNQUALIFIED', tenantPermissionBoundaries: 'NOT_MEASURED', nativeSchema: 'NOT_MEASURED' };

describe.each(['PRISMA', 'POSTGRES'])('%s runtime role preflight', driver => {
  it('returns only a scoped observation after transaction completion', async () => {
    const f = fixture(driver);
    const result = await f.run();
    expect(result).toEqual({ ...scope, driver, status: 'OBSERVED_MATCH', reason: 'ROLE_CAPABILITIES_OBSERVED' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.settled()).toBe(true);
    expect(f.calls.filter(q => q.text.includes('AS read_only'))).toHaveLength(2);
    expect(f.calls[0].text).toContain(driver === 'PRISMA' ? 'READ ONLY' : 'set_config');
    if (driver === 'PRISMA') {
      expect(f.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
    } else expect(f.transaction.mock.calls[0][0]).toBe('isolation level repeatable read read only');
    const settings = f.calls.find(q => q.text.includes('set_config')).text;
    for (const setting of ['statement_timeout', 'lock_timeout', 'transaction_timeout', 'idle_in_transaction_session_timeout', 'search_path']) expect(settings).toContain(setting);
  });

  it.each([
    ['login', 'attacker'], ['session', 'owner'], ['major', 16], ['read_only', 'off'],
    ['isolation', 'read committed'], ['path', 'public'], ['pid', 0],
  ])('refuses invalid session %s', async (key, value) => {
    const f = fixture(driver); f.state.identity[key] = value;
    expect(await f.run()).toMatchObject({ ...scope, status: 'INCOMPATIBLE', reason: 'SESSION_PROFILE_MISMATCH' });
  });
  it.each(['superuser', 'create_role', 'create_db', 'replication', 'bypass_rls'])('refuses %s in either reachable role', async key => {
    for (const index of [0, 1]) {
      const f = fixture(driver); f.state.roles[index][key] = true;
      expect(await f.run()).toMatchObject({ status: 'INCOMPATIBLE', reason: 'ROLE_PROFILE_MISMATCH' });
    }
  });
  it.each(['member', 'usage', 'settable'])('requires the exact app %s capability', async key => {
    const f = fixture(driver); f.state.roles[1][key] = false;
    expect(await f.run()).toMatchObject({ status: 'INCOMPATIBLE' });
  });
  it.each(['admin_option', 'inherit_option', 'set_option'])('refuses membership drift: %s', async key => {
    const f = fixture(driver); f.state.memberships[0][key] = !f.state.memberships[0][key];
    expect(await f.run()).toMatchObject({ status: 'INCOMPATIBLE', reason: 'ROLE_MEMBERSHIP_MISMATCH' });
  });
  it('refuses extra/transitive roles and incoming runtime memberships', async () => {
    const f = fixture(driver); f.state.roles.push({ ...app, name: 'pg_monitor' });
    expect(await f.run()).toMatchObject({ status: 'INCOMPATIBLE' });
    const g = fixture(driver); g.state.memberships.push({ ...g.state.memberships[0], member: 'other' });
    expect(await g.run()).toMatchObject({ status: 'INCOMPATIBLE' });
  });
  it.each(['create_db', 'temp', 'database_grant', 'schema_create', 'schema_grant', 'owned_objects', 'parameter_grants', 'settings'])('refuses native authority %s', async key => {
    const f = fixture(driver); f.state.authority[key] = typeof f.state.authority[key] === 'boolean' ? true : 1;
    expect(await f.run()).toMatchObject({ status: 'INCOMPATIBLE', reason: 'ADMINISTRATIVE_CAPABILITY_PRESENT' });
  });
  it.each([
    { identity: null }, { roles: [] }, { memberships: [] }, { authority: null },
    { authority: {} }, { roles: [runtime, { ...app, admin: null }] },
    { authority: { connect: true, schemas: 0 } },
  ])('fails closed on partial catalog data %#', async patch => {
    expect(await fixture(driver, patch).run()).not.toMatchObject({ status: 'OBSERVED_MATCH' });
  });
  it.each(['42501', '57014', '55P03', '25P04', 'P2028', '25006', 'ECONNRESET'])('sanitizes query failure %s and awaits exit', async code => {
    const f = fixture(driver, { error: Object.assign(Error('postgresql://secret:password@private/db'), { code }) });
    const result = await f.run();
    expect(result).toMatchObject({ ...scope, status: 'FAILED' });
    expect(JSON.stringify(result)).not.toMatch(/password|private|secret|postgresql/);
    expect(f.settled()).toBe(true);
  });
  it('does not publish a match when commit/rollback completion fails', async () => {
    expect(await fixture(driver, { finishError: Error('secret') }).run()).toMatchObject({ status: 'FAILED' });
  });
  it.each([['55P03','PROBE_TIMEOUT'],['25006','READ_ONLY_VIOLATION']])('decodes the native code inside Prisma P2010: %s', async (code, reason) => {
    const f = fixture(driver, { error: { code:'P2010',meta:{ code,message:'private detail' } } });
    expect(await f.run()).toEqual({ ...scope,driver,status:'FAILED',reason });
  });
  it('re-reads on every call, including permission loss after success', async () => {
    const f = fixture(driver);
    expect((await f.run()).status).toBe('OBSERVED_MATCH');
    f.state.roles[0].create_role = true;
    expect((await f.run()).status).toBe('INCOMPATIBLE');
    expect(f.transaction).toHaveBeenCalledTimes(2);
  });
  it('does not share success across different concurrent clients', async () => {
    const a = fixture(driver), b = fixture(driver); b.state.identity.login = 'foreign';
    const [good, bad] = await Promise.all([a.run(), b.run()]);
    expect(good.status).toBe('OBSERVED_MATCH'); expect(bad.status).toBe('INCOMPATIBLE');
    expect(a.transaction).toHaveBeenCalledOnce(); expect(b.transaction).toHaveBeenCalledOnce();
  });
  it('cannot accept a caller-supplied readiness claim', async () => {
    const inspect = driver === 'PRISMA' ? inspectPrismaRuntimeRole : inspectPostgresRuntimeRole;
    for (const input of [undefined, null, true, { ready: true }, { status: 'OBSERVED_MATCH' }, () => ({ ready: true })]) {
      expect(await inspect(input)).toMatchObject({ ...scope, status: 'UNKNOWN', reason: 'CLIENT_UNQUALIFIED' });
    }
  });
});
it('has no automatic caller, I/O imports, URL/env fallback or startup authority', () => {
  const source = readFileSync(new URL('../services/startup/runtimeRolePreflight.js', import.meta.url), 'utf8');
  expect(source).not.toMatch(/(?:from\s*['"]|import\s*\(|process\.env|DATABASE_URL|trust\.receipts|Promise\.race)/);
  for (const path of ['../server.js', '../workers/index.js', '../services/startup/startupAdmission.js']) {
    expect(readFileSync(new URL(path, import.meta.url), 'utf8')).not.toContain('runtimeRolePreflight');
  }
});
