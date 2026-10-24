import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const driver = vi.hoisted(() => vi.fn(() => { throw Error('private-credential-must-not-leak'); }));
const migrationChild = vi.hoisted(() => vi.fn(() => { throw Error('unexpected migration child'); }));
vi.mock('postgres', () => ({ default: driver }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal(), spawn: migrationChild }));
import { loadFreshContract, digest, ROLES } from '../../scripts/fresh-target/contract.js';
import { provisionFreshTarget, inspectFreshTarget } from '../../scripts/fresh-target/provision.js';

beforeEach(() => { driver.mockClear(); migrationChild.mockClear(); });
function request() {
  const approval = { version: 1, operation: 'PROVISION_EMPTY_PG17', expiresAt: Date.now() + 60000, artifactSha256: loadFreshContract().artifactSha256,
    target: { host: '127.0.0.1', port: 55559, database: 'lumi_fresh_unit', login: ROLES.migrator, serverAddress: '127.0.0.1', serverPort: 55559, systemIdentifier: '7699552998037871636', databaseOid: 16384, platformOwner: 'lumifresh_lab_admin' } };
  return { approval, approvalSha256: digest(JSON.stringify(approval)), url: 'postgresql://lumi_backend_migrator:private-credential-must-not-leak@127.0.0.1:55559/lumi_fresh_unit', caPem: undefined };
}

describe('operator fresh-target source contract', () => {
  it('pins all76 immutable migration artifacts', () => {
    const contract = loadFreshContract();
    expect(contract.migrations).toHaveLength(76);
    expect(contract.migrations.at(-1).name).toBe('20261015000000_canonical_provenance_v1');
    expect(contract.migrations.every(m => /^[a-f0-9]{64}$/.test(m.checksum))).toBe(true);
  });
  it('includes all26 reviewed legacy DDL statements, with no credential data repair', () => {
    const { legacy } = loadFreshContract();
    expect(legacy).toHaveLength(26);
    expect(legacy.every(d => !d.query.includes('${') && /^\s*(CREATE|ALTER|DROP TRIGGER|DO\b)/.test(d.query))).toBe(true);
    expect(legacy.map(d => d.file)).toContain('src/models/credential.js');
    expect(legacy.some(d => /backfillWorkspaceIds|UPDATE marcom_credentials|DELETE FROM marcom_credentials/i.test(d.query))).toBe(false);
  });
});

describe('operator invocation refuses untrusted inputs before database I/O', () => {
  for (const [name, mutate] of [
    ['missing independent approval digest', r => { delete r.approvalSha256; }],
    ['mismatched approval digest', r => { r.approvalSha256 = '0'.repeat(64); }],
    ['expired approval', r => { r.approval.expiresAt = 0; }],
    ['different binary artifact', r => { r.approval.artifactSha256 = '0'.repeat(64); }],
    ['replacement manifest', r => { r.manifestPath = '/forged'; }],
    ['replacement source root', r => { r.root = '/forged'; }],
    ['hidden replacement root', r => { Object.defineProperty(r, 'root', { value: '/forged' }); }],
    ['target extra property', r => { r.approval.target.root = '/forged'; }],
    ['application role as platform owner', r => { r.approval.target.platformOwner = ROLES.runtime; }],
    ['wrong URL database', r => { r.url += '_other'; }],
    ['plaintext URL query override', r => { r.url += '?sslmode=disable'; }],
    ['wrong login', r => { r.url = r.url.replace(ROLES.migrator, 'postgres'); }],
    ['non-loopback without verified CA', r => { r.approval.target.host = 'unapproved.example'; r.url = r.url.replace('127.0.0.1', 'unapproved.example'); }],
  ]) {
    it(name, async () => {
      const r = request(); mutate(r);
      // Re-sign only the changed approval to exercise its shape/target checks;
      // an explicitly missing/mismatched independent digest stays invalid.
      if (!name.includes('digest')) r.approvalSha256 = digest(JSON.stringify(r.approval));
      const result = await provisionFreshTarget(r);
      expect(result.status).toBe('REFUSED'); expect(result.runtimeAdmission).toBe('NOT_WIRED'); expect(driver).not.toHaveBeenCalled();
    });
  }
  it('rejects accessors and proxies without invoking caller code', async () => {
    let invoked = false;
    const r = request(); Object.defineProperty(r, 'url', { get() { invoked = true; throw Error(); } });
    expect((await provisionFreshTarget(r)).status).toBe('REFUSED'); expect(invoked).toBe(false);
    expect((await provisionFreshTarget(new Proxy(request(), {}))).status).toBe('REFUSED'); expect(driver).not.toHaveBeenCalled();
  });
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.2', '127.1', '2130706433', '0x7f000001', '127.0.0.1.', 'example.test']) {
    for (const suppliedCA of [false, true]) {
      it(`refuses mutating ${host}, CA=${suppliedCA}, before driver or migration child activity`, async () => {
        const r = request(); r.approval.target.host = host; r.url = r.url.replace('127.0.0.1', host);
        if (suppliedCA) r.caPem = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----';
        r.approvalSha256 = digest(JSON.stringify(r.approval));
        expect(await provisionFreshTarget(r)).toEqual({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT',
          scope: 'FRESH_TARGET_PROVISIONING_ONLY', runtimeAdmission: 'NOT_WIRED' });
        expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
      });
    }
  }
  it('requires verified CA for non-loopback read-only inspection before connecting', async () => {
    const r = request(); r.approval.target.host = 'localhost'; r.url = r.url.replace('127.0.0.1', 'localhost');
    r.approvalSha256 = digest(JSON.stringify(r.approval));
    expect(await inspectFreshTarget(r)).toMatchObject({ status: 'REFUSED', reason: 'VERIFIED_TLS_REQUIRED', phase: 'INPUT' });
    expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
  });
  it('uses strict TLS and a supplied CA for every non-loopback read-only inspection', async () => {
    const r = request(); r.approval.target.host = 'example.test'; r.approval.target.serverAddress = '203.0.113.1'; r.url = r.url.replace('127.0.0.1', 'example.test');
    r.caPem = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'; r.approvalSha256 = digest(JSON.stringify(r.approval));
    const result = await inspectFreshTarget(r);
    expect(driver).toHaveBeenCalledOnce(); expect(driver.mock.calls[0][1]).toMatchObject({ ssl: { rejectUnauthorized: true, ca: r.caPem }, max: 1, prepare: false });
    expect(result.status).toBe('REFUSED'); expect(JSON.stringify(result)).not.toMatch(/private|postgresql|password|example/);
  });
  it('refuses an uncertain connection cleanup and sanitizes its diagnostic', async () => {
    driver.mockImplementationOnce(() => ({ begin: async () => { throw Error('private-credential'); }, end: async () => { throw Error('private-credential'); } }));
    expect(await provisionFreshTarget(request())).toMatchObject({ status: 'REFUSED', reason: 'CONNECTION_CLEANUP_FAILED', phase: 'CLEANUP' });
  });
  it('the actual CLI requires explicit inputs and rejects operator root/manifest substitution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-cli-')), file = join(dir, 'approval.json');
    const entry = fileURLToPath(new URL('../../scripts/fresh-target/cli.js', import.meta.url));
    const clean = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: dir, TMP: dir, USERPROFILE: dir,
      CHECKPOINT_DISABLE: '1', NODE_OPTIONS: process.env.NODE_OPTIONS, LUMI605_AUDIT: process.env.LUMI605_AUDIT };
    const absent = spawnSync(process.execPath, [entry], { env: { ...clean, DATABASE_URL: 'postgresql://unused@127.0.0.1:1/no_fallback' }, encoding: 'utf8', timeout: 3500, windowsHide: true });
    expect(absent.status).toBe(1); expect(JSON.parse(absent.stdout).reason).toBe('EXPLICIT_OPERATOR_INPUT_REQUIRED');
    for (const override of ['root', 'manifestPath']) {
      const r = request(); r.approval[override] = '/unapproved'; writeFileSync(file, JSON.stringify(r.approval));
      const child = spawnSync(process.execPath, [entry], { env: { ...clean, FRESH_TARGET_APPROVAL_FILE: file,
        FRESH_TARGET_APPROVAL_SHA256: digest(JSON.stringify(r.approval)), FRESH_TARGET_URL: r.url }, encoding: 'utf8', timeout: 3500, windowsHide: true });
      expect(child.status, child.stderr).toBe(1); expect(JSON.parse(child.stdout).reason).toBe('APPROVAL_UNQUALIFIED');
      expect(child.stdout).not.toContain('private-credential');
    }
  });
});

describe('sealed artifact mutation tests', () => {
  let root, original, isolated;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lumi-fresh-source-'));
    const paths = ['scripts/fresh-target/contract.js', 'scripts/fresh-target/catalog.js', 'scripts/fresh-target/provision.js', 'scripts/fresh-target/cli.js', 'scripts/fresh-target/profile.v1.json', 'scripts/legacy-schema/manifest.v2.json'];
    const manifest = JSON.parse(readFileSync(new URL('../../scripts/legacy-schema/manifest.v2.json', import.meta.url)));
    paths.push(...Object.keys(manifest.source.sources), ...manifest.source.migrations.map(m => `prisma/migrations/${m.name}/migration.sql`));
    original = new Map(paths.map(path => [path, readFileSync(new URL('../../' + path, import.meta.url))]));
    for (const [path, bytes] of original) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
    isolated = await import(pathToFileURL(join(root, 'scripts/fresh-target/contract.js')).href);
    expect(isolated.loadFreshContract().migrations).toHaveLength(76);
  });
  for (const path of ['scripts/migrate.js', 'prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql', 'scripts/fresh-target/profile.v1.json', 'scripts/legacy-schema/manifest.v2.json']) {
    it(`refuses altered source: ${path}`, () => {
      writeFileSync(join(root, path), Buffer.concat([original.get(path), Buffer.from('\n-- forged\n')]));
      try { expect(() => isolated.loadFreshContract()).toThrow(/UNQUALIFIED/); } finally { writeFileSync(join(root, path), original.get(path)); }
      expect(driver).not.toHaveBeenCalled();
    });
  }
  it('refuses CRLF migrations rather than silently changing receipt identity', () => {
    const path = 'prisma/migrations/20261015000000_canonical_provenance_v1/migration.sql';
    writeFileSync(join(root, path), original.get(path).toString().replaceAll('\n', '\r\n'));
    try { expect(() => isolated.loadFreshContract()).toThrow('MIGRATION_BYTES_UNQUALIFIED'); } finally { writeFileSync(join(root, path), original.get(path)); }
  });
});
