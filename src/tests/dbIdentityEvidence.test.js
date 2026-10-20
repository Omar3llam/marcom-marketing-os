import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const state = vi.hoisted(() => ({ calls: [], error: null }));
vi.mock('postgres', () => ({ default: vi.fn((url, options) => {
  state.calls.push({ url, options });
  const sql = async () => { throw state.error || Object.assign(new Error('private SQL customer error'), { code: '42501' }); };
  sql.begin = async (mode, fn) => { state.calls.push({ mode }); return fn(sql); };
  sql.end = vi.fn(async () => {}); state.sql = sql; return sql;
}) }));
import { createDbIdentityProbe, expectedIdentityBinding } from '../services/startup/dbIdentityEvidence.js';

const target = () => ({ host: '127.0.0.1', port: 55451, database: 'lumi591_identity', login: 'lab591_runtime', owner: 'lab591_owner', reader: 'lab591_reader', systemIdentifier: '7700000000000000000', versionMajor: 17 });
let sequence = 0;
const request = () => {
  const t = target(); const now = Date.now();
  return { url: `postgresql://${t.login}@${t.host}:${t.port}/${t.database}`, target: t, profile: 'LAB_READ_ONLY_V1', challenge: { nonce: (++sequence).toString(16).padStart(64, '0'), issuedAt: now, expiresAt: now + 5000, bindingHash: expectedIdentityBinding(t) } };
};
beforeEach(() => { state.calls = []; state.error = null; });
const root = new URL('../../', import.meta.url), source = new Map();
beforeAll(() => {
  function walk(dir) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(file.name + (file.isDirectory() ? '/' : ''), dir);
      if (file.isDirectory()) walk(path);
      else if (/\.jsx?$/.test(file.name) && !/\.(test|spec)\./.test(file.name)) source.set(file.name + ':' + path.href, readFileSync(path, 'utf8'));
    }
  }
  walk(new URL('src/', root));
});
describe('explicit lab identity observation — unit refusal only, not real PG qualification', () => {
  it.each([undefined, null, {}, true, []])('rejects absent configuration before driver invocation: %j', async input => {
    expect(await createDbIdentityProbe().observe(input)).toMatchObject({ status: 'UNKNOWN' });
    expect(state.calls).toHaveLength(0);
  });
  it.each(['localhost', '::1', 'db.neon.tech', '127.0.0.2', '/tmp', '127.0.0.1,db.neon.tech'])('rejects non-qualified host %s before I/O', async host => {
    const r = request(); r.target.host = host;
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN');
    expect(state.calls).toHaveLength(0);
  });
  it.each(['postgresql://lab591_runtime@127.0.0.1:55451/lumi591_identity?options=-crole=other', 'postgresql://lab591_runtime@127.0.0.1:55451/lumi591_identity#fragment', 'postgresql://lab591_runtime:secret@127.0.0.1:55451/lumi591_identity', 'postgresql://lab591_runtime@remote.invalid:55451/lumi591_identity', 'postgresql://lab591_runtime@127.0.0.1:5432/lumi591_identity'])('rejects URL overrides before I/O', async url => {
    const r = request(); r.url = url;
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it.each(['open', 'sql', 'result', 'rows', 'query', 'connection', 'trust'])('rejects untrusted seam %s before I/O', async key => {
    const r = request(); r[key] = { status: 'OBSERVED_MATCH' };
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it.each(['host', 'port', 'database', 'login', 'owner', 'reader', 'systemIdentifier', 'versionMajor'])('rejects missing target %s', async key => {
    const r = request(); delete r.target[key];
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it.each(['expired', 'future', 'overlong', 'rebound', 'nonce', 'profile'])('rejects invalid challenge/policy %s before I/O', async kind => {
    const r = request();
    if (kind === 'expired') r.challenge.expiresAt = Date.now() - 1;
    if (kind === 'future') r.challenge.issuedAt = Date.now() + 1000;
    if (kind === 'overlong') r.challenge.expiresAt = r.challenge.issuedAt + 10001;
    if (kind === 'rebound') r.challenge.bindingHash = '0'.repeat(64);
    if (kind === 'nonce') r.challenge.nonce = '';
    if (kind === 'profile') r.profile = 'PRODUCTION';
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it('uses explicit driver settings and never leaks SQL/target/role details', async () => {
    const r = request(); const result = await createDbIdentityProbe().observe(r);
    expect(result).toMatchObject({ status: 'FAILED', scope: 'LAB_IDENTITY_PRIVILEGES_ONLY', tenantPermissionBoundaries: 'NOT_MEASURED', runtimeAdmission: 'NOT_WIRED' });
    expect(state.calls[0].options).toMatchObject({ host: '127.0.0.1', port: 55451, username: 'lab591_runtime', database: 'lumi591_identity', ssl: false, prepare: false, fetch_types: false, connect_timeout: 2, target_session_attrs: 'primary' });
    expect(state.calls[0].options.password()).toBe('');
    expect(state.calls[1].mode).toBe('isolation level repeatable read read only');
    expect(state.sql.end).toHaveBeenCalled();
    for (const text of ['private SQL', 'customer', 'lab591_', 'postgresql://', 'SYNTHETIC_READ_ONLY_FIXTURE']) expect(JSON.stringify(result)).not.toContain(text);
    expect(result.status).not.toBe('READY');
  });
  it.each([['ECONNREFUSED', 'NOT_CONNECTED'], ['CONNECT_TIMEOUT', 'NOT_CONNECTED'], ['42501', 'FAILED'], ['25006', 'FAILED'], ['57014', 'FAILED'], ['55P03', 'FAILED']])('sanitizes %s as %s', async (code, status) => {
    state.error = Object.assign(new Error('secret SQL role'), { code });
    expect((await createDbIdentityProbe().observe(request())).status).toBe(status);
  });
  it('consumes the challenge even on failure, rejects replay without another connection', async () => {
    const probe = createDbIdentityProbe(), r = request(); await probe.observe(r);
    const count = state.calls.length;
    expect(await probe.observe(r)).toMatchObject({ status: 'UNKNOWN', reason: 'CHALLENGE_REPLAYED' }); expect(state.calls).toHaveLength(count);
  });
  it('rejects replay through a different invoker in the same process', async () => {
    const r = request(); await createDbIdentityProbe().observe(r); const count = state.calls.length;
    expect(await createDbIdentityProbe().observe(r)).toMatchObject({ status: 'UNKNOWN', reason: 'CHALLENGE_REPLAYED' });
    expect(state.calls).toHaveLength(count);
  });
  it('binding digest changes with every expected identity field and excludes secrets', () => {
    const t = target(), original = expectedIdentityBinding(t); expect(original).toMatch(/^[a-f0-9]{64}$/);
    for (const key of Object.keys(t)) expect(expectedIdentityBinding({ ...t, [key]: String(t[key]) + 'x' })).not.toBe(original);
  });
  it('rejects a copied observed result as a new invocation instead of trusting its status', async () => {
    expect((await createDbIdentityProbe().observe({ status: 'OBSERVED_MATCH', bindingHash: 'a'.repeat(64) })).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it('rejects accessor/proxy configurations before I/O and snapshots caller data before awaiting', async () => {
    const accessor = request(); Object.defineProperty(accessor, 'url', { get() { throw new Error('must not call'); }, enumerable: true });
    expect((await createDbIdentityProbe().observe(accessor)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
    expect((await createDbIdentityProbe().observe(new Proxy(request(), {}))).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
    const r = request(), original = r.url, pending = createDbIdentityProbe().observe(r);
    r.url = 'postgresql://remote.invalid/production'; r.target.host = 'remote.invalid'; r.challenge.expiresAt = Infinity;
    await pending; expect(state.calls[0].url).toBe(original); expect(state.calls[0].options.host).toBe('127.0.0.1');
  });
  it.each(['overflow', 'noncanonical', 'hiddenOverride'])('rejects malformed target %s before I/O', async kind => {
    const r = request();
    if (kind === 'overflow') r.target.systemIdentifier = '99999999999999999999';
    if (kind === 'noncanonical') r.url = ' ' + r.url;
    if (kind === 'hiddenOverride') Object.defineProperty(r, 'open', { value: () => {}, enumerable: false });
    expect((await createDbIdentityProbe().observe(r)).status).toBe('UNKNOWN'); expect(state.calls).toHaveLength(0);
  });
  it('fails closed at bounded nonce capacity instead of evicting replay protection', async () => {
    const probe = createDbIdentityProbe();
    for (let n = 0; n < 256; n++) { const r = request(); r.challenge.nonce = 'f'.repeat(16) + n.toString(16).padStart(48, '0'); await probe.observe(r); }
    const count = state.calls.length;
    expect(await probe.observe(request())).toMatchObject({ status: 'UNKNOWN', reason: 'INVOKER_CAPACITY_EXHAUSTED' });
    expect(state.calls).toHaveLength(count);
  });
  it('compiled probe SQL contains no write statements or untrusted SQL execution seam', () => {
    const text = source.get('dbIdentityEvidence.js:' + new URL('src/services/startup/dbIdentityEvidence.js', root).href);
    expect(text).not.toMatch(/\.unsafe\s*\(|\bprocess\.env|dotenv|legacy-schema|backfillWorkspaceIds/);
    const queries = [...text.matchAll(/\bsql`([\s\S]*?)`/g)].map(m => m[1].replace(/'([^']|'')*'/g, "''").replace(/\bAS\s+(create|insert|update)\b/gi, 'AS field'));
    expect(queries.length).toBeGreaterThan(14);
    for (const query of queries) {
      expect(query).toMatch(/^\s*(SELECT|WITH|SET LOCAL)\b/);
      expect(query).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|COPY|CALL|DO)\b/i);
    }
  });
  it('preserves the synthetic candidate and forbids runtime imports of the standalone probe', () => {
    const text = source.get('startupAdmission.js:' + new URL('src/services/startup/startupAdmission.js', root).href).replaceAll('\r\n', '\n');
    expect(createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')).toBe('b4ea2d9da03d06e30284c56f5baf74c3ee5fa0e8');
    expect(source.size).toBeGreaterThan(400);
    for (const [path, text] of source) if (!path.startsWith('dbIdentityEvidence.js:')) expect(text).not.toContain('dbIdentityEvidence');
  });
});
