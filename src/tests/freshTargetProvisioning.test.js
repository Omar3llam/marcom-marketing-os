import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync, renameSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
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
  it('refuses unqualified loopback mutation before opening even the preflight connection', async () => {
    expect(await provisionFreshTarget(request())).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT' });
    expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
  });
  for (const [name, change] of [
    ['a scope flag without a qualification artifact', r => { r.approval.exclusiveTarget = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY' }; }],
    ['an absent qualification artifact', r => { r.approval.exclusiveTarget = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY', qualificationFile: join(tmpdir(), 'not-a-qualified-lumi-artifact.json'), qualificationSha256: '1'.repeat(64) }; }],
    ['a replaced qualification artifact', r => {
      const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-policy-')), file = join(dir, 'qualification.json');
      writeFileSync(file, '{}');
      r.approval.exclusiveTarget = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY', qualificationFile: file, qualificationSha256: digest('original independently supplied record') };
    }],
    ['an approved hash of an incomplete record', r => {
      const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-policy-')), file = join(dir, 'qualification.json');
      writeFileSync(file, '{}');
      r.approval.exclusiveTarget = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY', qualificationFile: file, qualificationSha256: digest('{}') };
    }],
  ]) {
    it(`refuses ${name} before I/O`, async () => {
      const r = request(); change(r); r.approvalSha256 = digest(JSON.stringify(r.approval));
      expect((await provisionFreshTarget(r)).status).toBe('REFUSED');
      expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
    });
  }
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
    expect(await inspectFreshTarget(request())).toMatchObject({ status: 'REFUSED', reason: 'CONNECTION_CLEANUP_FAILED', phase: 'CLEANUP' });
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
    const paths = ['scripts/fresh-target/exclusiveTargetController.js', 'scripts/fresh-target/contract.js', 'scripts/fresh-target/catalog.js', 'scripts/fresh-target/provision.js', 'scripts/fresh-target/cli.js', 'scripts/fresh-target/profile.v1.json', 'scripts/legacy-schema/manifest.v2.json'];
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

describe('physical writer boundary cannot be asserted by policy seals', () => {
  it('refuses an otherwise valid sealed policy outside an enforced cell before any database I/O', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumi-boundary-red-'));
    const cert = join(dir, 'ca.crt');
    const made = spawnSync(process.env.FRESH_TARGET_TEST_OPENSSL_BIN || 'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=LUMI SYNTHETIC BOUNDARY TEST',
        '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', join(dir, 'ca.key'), '-out', cert],
      { encoding: 'utf8', timeout: 5000, windowsHide: true });
    expect(made.status, made.stderr).toBe(0);
    const r = request(), c = loadFreshContract(), password = 'a'.repeat(64);
    r.url = r.url.replace('private-credential-must-not-leak', password); r.caPem = readFileSync(cert, 'utf8');
    const engines = new URL('node_modules/@prisma/engines/', c.root);
    const engine = readdirSync(engines).find(n => n.startsWith('schema-engine-') && !n.endsWith('.gz')
      && (process.platform === 'win32' ? n.endsWith('.exe') : !n.endsWith('.exe')));
    expect(engine).toBeTruthy();
    const q = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY', target: r.approval.target,
      artifactSha256: c.artifactSha256, caSha256: digest(r.caPem), credentialSha256: digest(password),
      cliSha256: digest(readFileSync(new URL('node_modules/prisma/build/index.js', c.root))),
      engineSha256: digest(readFileSync(new URL(engine, engines))), engineRevision: '605197351a3c8bdd595af2d2a9bc3025bca48ea2',
      networkPolicySha256: '1'.repeat(64), evidenceSha256: '2'.repeat(64) };
    const path = join(dir, 'qualification.json'), bytes = JSON.stringify(q); writeFileSync(path, bytes);
    r.approval.exclusiveTarget = { version: 1, scope: q.scope, qualificationFile: path, qualificationSha256: digest(bytes) };
    r.approvalSha256 = digest(JSON.stringify(r.approval));
    const result = await provisionFreshTarget(r);
    console.info('POLICY_ONLY_BOUNDARY_OBSERVATION', JSON.stringify({ result, driverCalls: driver.mock.calls.length, migrationChildren: migrationChild.mock.calls.length }));
    expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT' });
    for (const leaseFile of ['/tmp/forged-lease.json', '/control/jobs/' + 'a'.repeat(32) + '/lease.json']) {
      const forged = JSON.stringify({ ...q, kernelLeaseFile: leaseFile, kernelLeaseSha256: '3'.repeat(64) });
      writeFileSync(path, forged); r.approval.exclusiveTarget.qualificationSha256 = digest(forged);
      r.approvalSha256 = digest(JSON.stringify(r.approval));
      expect(await provisionFreshTarget(r)).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT' });
      expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
    }
  });
});

describe('retained controller storage qualification', () => {
  it('refuses volatile, external and unapproved roots without a fallback', async () => {
    const { qualifyRetainedStorage } = await import('../../scripts/fresh-target/exclusiveTargetController.js');
    for (const path of ['/tmp', '/run', '/mnt/c', '/home/lumi_p0_20261031/other', '/home/lumi_p0_20261031/exclusive-binding-retained/../tmp'])
      expect(() => qualifyRetainedStorage(path)).toThrow('RETAINED_STORAGE_UNQUALIFIED');
  });
});


describe.runIf(process.platform === 'linux')('F01 independent OS trust bootstrap', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../scripts/legacy-schema/manifest.v2.json', import.meta.url), 'utf8')).source;
  const closure = [...new Set(['package.json', 'scripts/fresh-target/exclusiveTargetController.js', 'scripts/fresh-target/contract.js',
    'scripts/fresh-target/catalog.js', 'scripts/fresh-target/provision.js', 'scripts/fresh-target/cli.js',
    'scripts/fresh-target/profile.v1.json', 'scripts/legacy-schema/manifest.v2.json', 'prisma/migrations/migration_lock.toml',
    'node_modules/postgres/package.json', ...['index', 'types', 'connection', 'query', 'queue', 'errors', 'subscribe', 'large', 'result', 'bytes'].map(n => 'node_modules/postgres/src/' + n + '.js'),
    ...Object.keys(inventory.sources), ...inventory.migrations.map(m => 'prisma/migrations/' + m.name + '/migration.sql')])];
  const document = readFileSync(new URL('../../docs/BACKEND_FRESH_TARGET_PROVISIONING.md', import.meta.url), 'utf8');
  const fence = String.fromCharCode(96).repeat(3);
  const bootstrap = document.split('<!-- F01_BOOTSTRAP_BEGIN -->\n' + fence + 'python\n')[1]?.split(fence + '\n<!-- F01_BOOTSTRAP_END -->')[0];
  function fixture() {
    const base = mkdtempSync(join(homedir(), 'lumi-f01-unit-')), source = join(base, 'source');
    mkdirSync(source);
    const files = {};
    for (const path of closure) {
      const bytes = readFileSync(new URL('../../' + path, import.meta.url));
      mkdirSync(dirname(join(source, path)), { recursive: true });
      writeFileSync(join(source, path), bytes);
      files[path] = { sha256: digest(bytes), bytes: bytes.length, executable: false };
    }
    const runtime = join(base, 'unexecuted-runtime');
    writeFileSync(runtime, 'synthetic-runtime-data-never-executed');
    const bytes = readFileSync(runtime), identity = join(base, 'identity.json');
    const raw = JSON.stringify({ version: 1, scope: 'F01_REVIEWED_SOURCE_CLOSURE', files,
      runtime: { sha256: digest(bytes), bytes: bytes.length } });
    writeFileSync(identity, raw);
    return { base, source, runtime, identity, pin: digest(raw), marker: join(base, 'MUST_NOT_EXECUTE') };
  }
  function check(f, mode = '--verify-intake', label = 'unit') {
    expect(bootstrap).toBeTruthy();
    return spawnSync('/usr/bin/python3', ['-I', '-S', '-c', bootstrap, mode, f.source, f.runtime, f.identity, f.pin, label],
      { env: { PATH: '/usr/bin:/bin', HOME: f.base }, encoding: 'utf8', timeout: 3500 });
  }
  function refused(f, mode, label) {
    const r = check(f, mode, label);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).not.toContain('ROOT_SOURCE_SEALED');
    expect(r.stderr).toContain('PRIVILEGED_SOURCE_UNQUALIFIED');
    expect(existsSync(f.marker)).toBe(false);
    expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
  }
  it('verifies independently pinned intake without treating it as execution authorization', () => {
    const r = check(fixture());
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'INTAKE_BYTES_VERIFIED', applicationEvaluations: 0,
      databaseConnections: 0, migrationProcesses: 0 });
  });
  for (const path of ['scripts/fresh-target/catalog.js', 'scripts/fresh-target/profile.v1.json',
    'scripts/legacy-schema/manifest.v2.json', 'scripts/migrate.js',
    'prisma/migrations/' + inventory.migrations[0].name + '/migration.sql']) {
    it('refuses a pinned manifest missing a mandatory contract read: ' + path, () => {
      const f = fixture(), identity = JSON.parse(readFileSync(f.identity, 'utf8'));
      delete identity.files[path];
      const raw = JSON.stringify(identity); writeFileSync(f.identity, raw); f.pin = digest(raw);
      refused(f);
    });
  }
  it('refuses non-ASCII controller labels before any source execution', () => {
    refused(fixture(), '--verify-intake', 'unité');
  });
  it('refuses an oversized independently pinned identity before parsing it', () => {
    const f = fixture(), raw = ' '.repeat(262145);
    writeFileSync(f.identity, raw); f.pin = digest(raw);
    refused(f);
  });
  for (const path of ['scripts/fresh-target/exclusiveTargetController.js', 'scripts/fresh-target/contract.js', 'node_modules/postgres/src/index.js']) {
    it('refuses altered privileged closure bytes before evaluation: ' + path, () => {
      const f = fixture(), full = join(f.source, path);
      writeFileSync(full, "import { writeFileSync as unsafe } from 'node:fs';unsafe(" + JSON.stringify(f.marker) + ",'bad');\n" + readFileSync(full));
      refused(f);
    });
  }
  it('refuses a symlink source root', () => {
    const f = fixture(), moved = f.source + '-real';
    renameSync(f.source, moved); symlinkSync(moved, f.source, 'dir'); refused(f);
  });
  it('refuses a symlink closure member', () => {
    const f = fixture(), member = join(f.source, 'scripts/fresh-target/contract.js');
    renameSync(member, member + '.real'); symlinkSync(member + '.real', member); refused(f);
  });
  it('refuses a replaced source tree containing changed bytes', () => {
    const f = fixture(); renameSync(f.source, f.source + '-previous');
    const replacement = fixture(); renameSync(replacement.source, f.source);
    writeFileSync(join(f.source, 'scripts/fresh-target/contract.js'), '// replaced');
    refused(f);
  });
  it('never reuses an earlier intake check after file replacement', () => {
    const f = fixture(); expect(check(f).status).toBe(0);
    const entry = join(f.source, 'scripts/fresh-target/exclusiveTargetController.js');
    renameSync(entry, entry + '.previous');
    writeFileSync(entry, "import {writeFileSync} from 'node:fs';writeFileSync(" + JSON.stringify(f.marker) + ",'bad');");
    refused(f, '--launch');
  });
  it('refuses missing external identity', () => {
    const f = fixture(); f.identity += '-absent'; refused(f);
  });
  it('refuses an untrusted external identity digest', () => {
    const f = fixture(); f.pin = '0'.repeat(64); refused(f);
  });
  it('refuses a user-writable path substituted for the trusted root snapshot', async () => {
    const { qualifyTrustedControllerSource } = await import('../../scripts/fresh-target/exclusiveTargetController.js');
    const f = fixture();
    expect(() => qualifyTrustedControllerSource(f.source)).toThrow('PRIVILEGED_SOURCE_UNQUALIFIED');
    expect(driver).not.toHaveBeenCalled(); expect(migrationChild).not.toHaveBeenCalled();
  });
});
