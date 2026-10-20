import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const driver = vi.hoisted(() => vi.fn());
vi.mock('postgres', () => ({ default: driver }));
import { createCanonicalMigrationObserver, canonicalTargetBinding, historyMatches } from '../services/startup/canonicalMigrationEvidence.js';

const request = () => {
  const target = { host: '127.0.0.1', port: 55453, database: 'lumi594_canonical', login: 'lab594_observer', systemIdentifier: '7698690589386727940', versionMajor: 17 };
  const now = Date.now();
  return { target, url: `postgresql://${target.login}@127.0.0.1:55453/${target.database}`, challenge: { nonce: randomBytes(32).toString('hex'), issuedAt: now, expiresAt: now + 10000, bindingHash: canonicalTargetBinding(target) } };
};
beforeEach(() => { driver.mockReset(); driver.mockImplementation(() => { throw Object.assign(new Error('secret internal database detail'), { code: 'ECONNREFUSED' }); }); });
describe('explicit canonical native/history lab observer', () => {
  for (const mutate of [r => { r.target.host = 'localhost'; }, r => { r.target.port = 5432; }, r => { r.target.versionMajor = 16; }, r => { r.target.database = 'production'; }, r => { r.target.login = 'postgres'; }, r => { r.target.systemIdentifier = '0'; }, r => { r.url += '?sslmode=disable'; }, r => { r.url = r.url.replace('@', ':secret@'); }, r => { r.root = '/tmp/forged'; }, r => { r.manifestPath = '/tmp/forged'; }, r => { r.open = () => {}; }, r => { r.result = { status: 'OBSERVED_MATCH' }; }, r => { r.challenge.expiresAt = Date.now() - 1; }, r => { r.challenge.issuedAt = Date.now() + 20000; }, r => { r.challenge.bindingHash = '0'.repeat(64); }, r => { r.target.port = '55453'; }]) {
    it(`refuses unqualified input before database I/O: ${mutate.toString()}`, async () => {
      const r = request(); mutate(r);
      expect((await createCanonicalMigrationObserver().observe(r)).status).toBe('UNKNOWN'); expect(driver).not.toHaveBeenCalled();
    });
  }
  it('rejects hidden, accessor, proxy and partial input without I/O', async () => {
    for (const r of [null, {}, new Proxy(request(), {}), Object.defineProperty(request(), 'root', { value: 'forged' }), Object.defineProperty(request(), 'target', { get() { throw Error('must not execute'); } })]) {
      expect((await createCanonicalMigrationObserver().observe(r)).status).toBe('UNKNOWN');
    }
    expect(driver).not.toHaveBeenCalled();
  });
  it('sanitizes connection failure and fixes all scope disclaimers', async () => {
    const result = await createCanonicalMigrationObserver().observe(request());
    expect(result).toMatchObject({ status: 'NOT_CONNECTED', scope: 'LAB_CANONICAL_NATIVE_HISTORY_ONLY', runtimeAdmission: 'NOT_WIRED', tenantPermissionBoundaries: 'NOT_MEASURED' });
    expect(JSON.stringify(result)).not.toMatch(/secret|lab594|lumi594|postgresql|READY/);
    expect(driver.mock.calls[0][1]).toMatchObject({ ssl: false, max: 1, connect_timeout: 2, connection: { default_transaction_read_only: 'on' } });
    expect(driver.mock.calls[0][1].password()).toBe('');
  });
  it('refuses replay across separately created invokers', async () => {
    const r = request(); await createCanonicalMigrationObserver().observe(r); driver.mockClear();
    expect((await createCanonicalMigrationObserver().observe(r)).reason).toBe('CHALLENGE_REPLAYED'); expect(driver).not.toHaveBeenCalled();
  });
  for (const code of ['57014', '55P03', '25006', '42501', 'ECONNREFUSED', 'CONNECTION_CLOSED']) {
    it(`sanitizes driver failure ${code} and closes the connection`, async () => {
      const end = vi.fn(async () => {}), begin = vi.fn(async () => { throw Object.assign(Error('private'), { code }); });
      driver.mockReturnValue({ begin, end });
      const r = await createCanonicalMigrationObserver().observe(request());
      expect(['FAILED', 'NOT_CONNECTED']).toContain(r.status); expect(JSON.stringify(r)).not.toContain('private'); expect(end).toHaveBeenCalledOnce();
      expect(begin.mock.calls[0][0]).toBe('isolation level repeatable read read only');
    });
  }
  it('cleanup failure cannot report success', async () => {
    driver.mockReturnValue({ begin: async () => ({ status: 'OBSERVED_MATCH', reason: 'LAB_PROFILE_OBSERVED' }), end: async () => { throw Error('private'); } });
    expect((await createCanonicalMigrationObserver().observe(request())).reason).toBe('CONNECTION_CLEANUP_FAILED');
  });
  it('expired observation cannot report success', async () => {
    const r = request(); const now = Date.now;
    driver.mockReturnValue({ begin: async () => { vi.spyOn(Date, 'now').mockReturnValue(r.challenge.expiresAt); return { status: 'OBSERVED_MATCH' }; }, end: async () => {} });
    try { expect((await createCanonicalMigrationObserver().observe(r)).reason).toBe('OBSERVATION_EXPIRED'); } finally { Date.now = now; }
  });
  for (const [key, bad] of [['database','wrong'], ['login','wrong'], ['session','wrong'], ['address','::1'], ['port',5432], ['major',16], ['system_id','1'], ['read_only','off'], ['isolation','read committed'], ['path','public']]) {
    it(`refuses mismatched native identity field ${key}`, async () => {
      const r = request(), t = r.target;
      const identity = { database:t.database,login:t.login,session:t.login,address:t.host,port:t.port,major:17,system_id:t.systemIdentifier,read_only:'on',isolation:'repeatable read',path:'pg_catalog, pg_temp',[key]:bad };
      const tx = vi.fn(async pieces => pieces[0].startsWith('SELECT current_database') ? [identity] : []);
      const end = vi.fn(async () => {});
      driver.mockReturnValue({ begin: async (_, fn) => fn(tx), end });
      expect((await createCanonicalMigrationObserver().observe(r)).reason).toBe('SESSION_IDENTITY_MISMATCH'); expect(end).toHaveBeenCalledOnce();
    });
  }
  it('copies validated input before asynchronous database work', async () => {
    const r = request(); let release;
    const barrier = new Promise(resolve => { release = resolve; });
    driver.mockReturnValue({ begin: async () => { await barrier; return { status:'OBSERVED_MATCH',reason:'LAB_NATIVE_HISTORY_OBSERVED' }; }, end: async () => {} });
    const pending = createCanonicalMigrationObserver().observe(r); r.challenge.expiresAt = 0; r.target.database = 'forged'; release();
    expect((await pending).status).toBe('OBSERVED_MATCH');
    expect(driver.mock.calls[0][1].database).toBe('lumi594_canonical');
  });
});

describe('strict receipt semantics, no recovery normalization', () => {
  const sources = Array.from({ length: 76 }, (_, i) => ({ name: `migration_${i}`, checksum: String(i).padStart(64, '0') }));
  const rows = () => sources.map(s => ({ migration_name: s.name, checksum: s.checksum, finished: true, rolled_back: false, clean_log: true, ordered: true, applied_steps_count: 1 }));
  it('accepts only a complete clean single-receipt history', () => { expect(historyMatches(rows(), sources)).toBe(true); });
  for (const change of [r => r.pop(), r => r.push({ ...r[0] }), r => { r[0].migration_name = 'unexpected'; }, r => { r[75].checksum = 'a'.repeat(64); }, r => { r[75].finished = false; }, r => { r[0].rolled_back = true; }, r => { r[0].clean_log = false; }, r => { r[0].ordered = false; }, r => { r[0].applied_steps_count = 0; }, r => { r[0].applied_steps_count = 2; }]) {
    it(`refuses history inconsistency: ${change.toString()}`, () => { const r = rows(); change(r); expect(historyMatches(r, sources)).toBe(false); });
  }
  it('refuses failed then rolled-back ancestors even alongside a good receipt', () => { const r = rows(); r.push({ ...r[75], finished: false, rolled_back: true }); expect(historyMatches(r, sources)).toBe(false); });
  it('source has no ambient credentials, dynamic SQL, operator overrides or business-row reads', () => {
    const text = readFileSync(new URL('../services/startup/canonicalMigrationEvidence.js', import.meta.url), 'utf8');
    expect(text).not.toMatch(/process\.env|dotenv|\.unsafe\(|manifestPath|DATABASE_URL/);
    expect(text).toContain('pg_catalog'); expect(text).toContain('repeatable read read only');
    expect(text).not.toMatch(/FROM public\.(?!_prisma_migrations)/);
  });
});
