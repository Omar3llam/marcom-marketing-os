import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import net from 'node:net';
import { provisionFreshTarget, inspectFreshTarget } from '../../scripts/fresh-target/provision.js';
import { loadFreshContract, digest, ROLES } from '../../scripts/fresh-target/contract.js';
import { collectCombinedCatalog, stable, bindPlatform } from '../../scripts/fresh-target/catalog.js';
import { collectStructure } from '../../scripts/legacy-schema/catalog.js';
import { bind } from '../../scripts/legacy-schema/contract.js';
import { verifyCanonicalProvenanceCatalog } from '../../scripts/verify-canonical-provenance-catalog.js';
import { seed, admit, level } from './canonicalProvenanceFixtures.js';
import { sealTemplate } from './dbIsolation.js';

const migrationChildren = vi.hoisted(() => []);
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal();
  return { ...original, spawn(...args) { migrationChildren.push(args); return original.spawn(...args); } };
});

const enabled = process.env.REQUIRE_DB === '1';
const commandDirs = [];
const command = (exe, args, env = process.env, observe, run = spawnSync) => {
  const options = { env, encoding: 'utf8', timeout: 20000, windowsHide: true };
  const started = observe ? { tick: performance.now(), at: new Date().toISOString() } : null;
  let r;
  if (process.platform === 'win32' && basename(exe).replace(/\.exe$/i, '') === 'pg_ctl' && args.at(-1) === 'start') {
    // The Windows daemon inherits piped output handles; spawnSync can time out
    // after pg_ctl has exited0. Files preserve diagnostics without that wait.
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-command-')); commandDirs.push(dir);
    const out = join(dir, 'stdout'), err = join(dir, 'stderr'), stdout = openSync(out, 'w'), stderr = openSync(err, 'w');
    try { r = run(exe, args, { ...options, stdio: ['ignore', stdout, stderr] }); }
    finally { closeSync(stdout); closeSync(stderr); }
    r.stdout = readFileSync(out, 'utf8'); r.stderr = readFileSync(err, 'utf8');
  } else r = run(exe, args, options);
  observe?.({ startedAt: started.at, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started.tick,
    exitCode: r.status, signal: r.signal ?? null, spawnError: r.error?.code ?? null });
  if (r.error || r.status !== 0) throw Error(`Fresh lab command failed: ${exe} (${r.status}): ${r.error?.code || r.stderr}`);
  return r.stdout.trim();
};
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const clusters = [], clients = [], certificateDirs = [];
let diagnosticDeadline = 0, diagnosticRemainingMs = 2000;

// Preserve CP-01's immediate observation and records. Owned-ID absence may now
// be confirmed by bounded read-only checks within the SAME deadline/allowance.
// Docker failures are never absence, and no removal command is added.
function dockerLifecycleDiagnostic(id, createCommand, controls = {}) {
  const run = controls.run ?? spawnSync, now = controls.now ?? (() => performance.now());
  const budget = controls.budget ?? {
    get deadline() { return diagnosticDeadline; },
    get remainingMs() { return diagnosticRemainingMs; },
    set remainingMs(value) { diagnosticRemainingMs = value; },
  };
  const host = ['--host', 'unix:///var/run/docker.sock'];
  const label = 'lumi.fresh-target.synthetic';
  const emit = record => { try {
    const evidence = { id: /^[a-f0-9]{64}$/.test(id) ? id : null, ...record };
    if (controls.emit) controls.emit(evidence);
    else console.info('CP01_DOCKER_LIFECYCLE', JSON.stringify(evidence));
  } catch { /* original errors must survive */ } };
  const date = value => typeof value === 'string' && /^[0-9T:Z.+-]{1,64}$/.test(value) ? value : null;
  const inspectFormat = '{"id":{{json .Id}},"image":{{json .Image}},"label":{{json (index .Config.Labels "lumi.fresh-target.synthetic")}},'
    + '"created":{{json .Created}},"startedAt":{{json .State.StartedAt}},"status":{{json .State.Status}},'
    + '"running":{{json .State.Running}},"dead":{{json .State.Dead}},"exitCode":{{json .State.ExitCode}},'
    + '"autoRemove":{{json .HostConfig.AutoRemove}},"finishedAt":{{json .State.FinishedAt}}}';
  function query(phase, args, decode, teardown = false) {
    if (!/^[a-f0-9]{64}$/.test(id)) return { phase, failure: 'OWNERSHIP_ID_UNQUALIFIED', exists: null };
    const available = budget.remainingMs;
    const timeout = Math.floor(teardown ? Math.min(250, available, budget.deadline - now()) : 500);
    if (timeout < 1) return { phase, skipped: 'DIAGNOSTIC_BUDGET', exists: null };
    const started = now(), startedAt = new Date().toISOString();
    let r;
    try {
      r = run('docker', [...host, ...args], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 32768, windowsHide: true });
      const meta = { phase, startedAt, finishedAt: new Date().toISOString(), elapsedMs: now() - started,
        exitCode: r.status, signal: r.signal ?? null, spawnError: r.error?.code ?? null };
      if (teardown && (now() >= budget.deadline || meta.elapsedMs >= available)) {
        return { ...meta, failure: 'DIAGNOSTIC_BUDGET', exists: null };
      }
      if (r.error || r.signal || r.status !== 0) {
        // A daemon/CLI error is UNKNOWN, not absence. Recognize only this exact owned-ID miss.
        const absent = !r.error && !r.signal && r.status === 1 && args[0] === 'inspect' && !(r.stdout ?? '').trim()
          && new RegExp(`^(?:Error(?: response from daemon)?: )?No such (?:object|container):\\s*${id}$`, 'i').test((r.stderr ?? '').trim());
        return { ...meta, exists: absent ? false : null, failure: absent ? null : 'COMMAND_FAILED' };
      }
      try { return { ...meta, ...decode(r.stdout) }; }
      catch { return { ...meta, failure: 'OUTPUT_UNQUALIFIED', exists: null }; }
    } catch { return { phase, startedAt, failure: 'DIAGNOSTIC_EXCEPTION', exists: null }; }
    finally { if (teardown) budget.remainingMs -= now() - started; }
  }
  const inspect = (phase, teardown = false) => query(phase, ['inspect', '--type', 'container', '--format', inspectFormat, id], stdout => {
    const s = JSON.parse(stdout);
    if (s.id !== id) throw Error('Unqualified identity');
    return { exists: true, image: /^sha256:[a-f0-9]{64}$/.test(s.image) ? s.image : null,
      ownershipLabel: { key: label, matches: s.label === 'true' }, created: date(s.created), startedAt: date(s.startedAt),
      status: ['created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'].includes(s.status) ? s.status : null,
      running: typeof s.running === 'boolean' ? s.running : null, dead: typeof s.dead === 'boolean' ? s.dead : null,
      containerExitCode: Number.isInteger(s.exitCode) ? s.exitCode : null,
      autoRemove: typeof s.autoRemove === 'boolean' ? s.autoRemove : null, finishedAt: date(s.finishedAt) };
  }, teardown);
  const initial = inspect('initial');
  const versions = query('version', ['version', '--format', '{"client":{{json .Client.Version}},"server":{{json .Server.Version}}}'], stdout => {
    const v = JSON.parse(stdout);
    if (![v.client, v.server].every(s => typeof s === 'string' && /^[0-9A-Za-z.+_-]{1,80}$/.test(s))) throw Error('Unqualified version');
    return { client: v.client, server: v.server };
  });
  emit({ phase: 'created', createCommand, initial, versions });
  return {
    requireOwnership() {
      if (!/^[a-f0-9]{64}$/.test(id) || createCommand?.exitCode !== 0 || initial.exists !== true
        || !initial.ownershipLabel?.matches || !initial.image || initial.autoRemove !== true) {
        throw Error('Owned Docker container identity unqualified');
      }
      if (versions.failure || versions.skipped) throw Error('Docker version observation unqualified');
    },
    requireCompletionBudget() {
      if (now() >= budget.deadline || budget.remainingMs <= 0) throw Error('Owned Docker teardown deadline or allowance expired');
    },
    confirmAbsence() {
      const checks = [];
      for (let attempt = 1; attempt <= 16; attempt++) {
        const observation = inspect(`absence-${attempt}`, true); checks.push(observation);
        if (observation.exists === false && !observation.failure && !observation.skipped) return { exists: false, checks };
        if (observation.exists !== true || observation.failure || observation.skipped) {
          return { exists: null, failure: observation.failure ?? observation.skipped ?? 'OBSERVATION_UNQUALIFIED', checks };
        }
        if (!observation.ownershipLabel?.matches || observation.image !== initial.image || observation.autoRemove !== true) {
          return { exists: null, failure: 'OWNERSHIP_CHANGED', checks };
        }
      }
      return { exists: true, failure: 'CONTAINER_REMAINS', checks };
    },
    afterStop(stopCommand, originalPsCommand, originalPresence, originalAssertion, absenceConfirmation) {
      try {
        // No diagnostic command or output occurs between stop and the original ps.
        const observations = [inspect('after-stop-1', true), inspect('after-stop-2', true)];
        const actions = ['create', 'start', 'kill', 'die', 'stop', 'destroy'];
        const until = new Date().toISOString();
        const events = query('events', ['events', '--filter', 'type=container', '--filter', `container=${id}`,
          ...actions.flatMap(action => ['--filter', `event=${action}`]), '--since', createCommand.startedAt, '--until', until,
          '--format', '{"id":{{json .Actor.ID}},"action":{{json .Action}},"timeNano":"{{.TimeNano}}"}'], stdout => {
          const lines = stdout.trim() ? stdout.trim().split('\n') : [];
          const records = lines.slice(0, 50).map(line => JSON.parse(line));
          if (records.some(r => r.id !== id || !actions.includes(r.action) || !/^\d{1,24}$/.test(r.timeNano))) throw Error('Unqualified event');
          return { until, records, truncated: lines.length > 50, retentionLimit: 256 };
        }, true);
        const final = inspect('final', true);
        const ids = originalPresence?.split('\n').filter(Boolean) ?? [];
        const qualified = ids.every(value => /^[a-f0-9]{12,64}$/.test(value) && id.startsWith(value));
        const record = { phase: 'teardown', stopCommand, originalPsCommand,
          originalPresence: qualified ? originalPresence ?? null : null, originalPresenceQualified: qualified,
          originalAssertion, absenceConfirmation, observations, events, final,
          cleanup: { originalAssertion, finalOwnedPresence: final.exists, mutationCommandsAdded: 0 },
          diagnosticBudgetRemainingMs: Math.max(0, budget.remainingMs) };
        emit(record);
        return record;
      } catch { emit({ phase: 'teardown', originalAssertion, failure: 'DIAGNOSTIC_EXCEPTION' }); }
    },
  };
}

// Shared by the real Linux fixture and deterministic command/clock cases below.
function stopOwnedDockerContainer(id, docker, diagnostic) {
  let stopResult, psResult, presence, failure, absenceConfirmation, assertion = 'NOT_REACHED';
  const stopArgs = ['stop', '-t', '5', id], psArgs = ['ps', '-aq', '--filter', `id=${id}`];
  try {
    diagnostic.requireOwnership();
    docker(stopArgs, r => { stopResult = r; });
    presence = docker(psArgs, r => { psResult = r; });
    // Retain the original immediate-condition result, independently of final
    // teardown acceptance. A transient listing must never be relabelled empty.
    assertion = presence === '' ? 'PASS' : 'FAIL';
    absenceConfirmation = diagnostic.confirmAbsence();
    if (absenceConfirmation.failure) throw Error(`Owned Docker absence unqualified: ${absenceConfirmation.failure}`);
    expect(absenceConfirmation.exists).toBe(false);
  } catch (err) { failure = err; }
  const record = diagnostic.afterStop({ command: ['docker', '--host', 'unix:///var/run/docker.sock', ...stopArgs], ...stopResult },
    { command: ['docker', '--host', 'unix:///var/run/docker.sock', ...psArgs], ...psResult }, presence, assertion, absenceConfirmation);
  if (failure) throw failure; // Diagnostic failures must never replace the original error.
  diagnostic.requireCompletionBudget();
  expect(record?.originalPresenceQualified).toBe(true);
  expect(record?.observations?.every(r => r.exists === false && !r.failure && !r.skipped)).toBe(true);
  expect(record?.events?.failure ?? null).toBeNull();
  expect(record?.events?.skipped).toBeUndefined();
  expect(record?.final?.failure ?? null).toBeNull();
  expect(record?.final?.exists).toBe(false); // Hard owned-container absence remains mandatory.
  return record;
}
async function physicalCluster() {
  const bin = process.env.FRESH_TARGET_TEST_PG_BIN;
  let port, stop, evidence, certificatePaths;
  if (bin) {
    if (!command(join(bin, 'postgres'), ['--version']).includes(' 17.')) throw Error('PG17 binary required');
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-pg17-')); port = await freePort();
    command(join(bin, 'initdb'), ['-D', join(dir, 'data'), '-U', 'lab_fresh_admin', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    stop = () => { command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']); expect(existsSync(join(dir, 'data', 'postmaster.pid'))).toBe(false); };
    clusters.push({ stop });
    command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    evidence = { physicalDirectory: dir, physicalControl: command(join(bin, 'pg_controldata'), [join(dir, 'data')]) };
    certificatePaths = (cert, key) => ({ cert, key });
  } else {
    // CI's explicitly approved postgres:17 service supplies this cached image.
    // Never pull/install/fall back to a remote database from a test.
    if (process.platform !== 'linux') throw Error('Supply an explicit local PG17 binary directory');
    const docker = (args, observe) => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args], process.env, observe);
    docker(['image', 'inspect', 'postgres:17']);
    let createCommand, diagnostic;
    const id = docker(['run', '--pull=never', '--rm', '-d', '--label', 'lumi.fresh-target.synthetic=true',
      '-e', 'POSTGRES_USER=lab_fresh_admin', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8', '-p', '127.0.0.1::5432', 'postgres:17'], r => { createCommand = r; });
    stop = () => stopOwnedDockerContainer(id, docker, diagnostic);
    clusters.push({ stop });
    diagnostic = dockerLifecycleDiagnostic(id, createCommand);
    port = Number(docker(['port', id, '5432/tcp']).split(':').at(-1));
    evidence = { container: id, image: docker(['inspect', '--format', '{{.Image}}', id]) };
    certificatePaths = (cert, key) => {
      docker(['cp', cert, `${id}:/tmp/lumi-server.crt`]); docker(['cp', key, `${id}:/tmp/lumi-server.key`]);
      docker(['exec', '--user', '0', id, 'chmod', '600', '/tmp/lumi-server.key']);
      docker(['exec', '--user', '0', id, 'chown', 'postgres:postgres', '/tmp/lumi-server.key']);
      return { cert: '/tmp/lumi-server.crt', key: '/tmp/lumi-server.key' };
    };
  }
  let admin;
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    admin = postgres({ host: '127.0.0.1', port, database: 'postgres', username: 'lab_fresh_admin', password: () => '', ssl: false, max: 1, connect_timeout: 1, onnotice: () => {} });
    try { await admin`SELECT 1`; break; } catch { await admin.end({ timeout: 1 }); admin = null; }
  }
  if (!admin) throw Error('New PG17 lab did not become ready');
  clients.push(admin);
  const [identity] = await admin`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`;
  expect(identity.major).toBe(17);
  if (bin) expect(evidence.physicalControl).toContain(identity.system);
  console.info('FRESH_TARGET_PHYSICAL_LAB', JSON.stringify({ port, ...identity, ...evidence }));
  const open = (database, username) => { const q = postgres({ host: '127.0.0.1', port, database, username, password: () => '', ssl: false, max: 1, onnotice: () => {} }); clients.push(q); return q; };
  const enableTLS = async (cert, key) => {
    const paths = certificatePaths(cert, key), literal = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "''") + "'";
    await admin.unsafe(`ALTER SYSTEM SET ssl_cert_file=${literal(paths.cert)}`);
    await admin.unsafe(`ALTER SYSTEM SET ssl_key_file=${literal(paths.key)}`);
    await admin`ALTER SYSTEM SET ssl='on'`; await admin`SELECT pg_reload_conf()`;
    const until = Date.now() + 10000;
    while (Date.now() < until) { const [r] = await admin`SHOW ssl`; if (r.ssl === 'on') return; }
    throw Error('Owned lab TLS reload did not complete');
  };
  return { admin, port, system: identity.system, open, enableTLS };
}

describe.skipIf(!enabled)('fresh PG17 operator / independent physical labs', () => {
  let lab, other, valid, db;
  beforeAll(async () => {
    // Full verification already owns a different physical PG17 service. Use
    // its read-only identity as the independent wrong-target witness rather
    // than initializing a redundant second cluster inside the hook budget.
    const witness = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    try { [other] = await witness`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`; }
    finally { await witness.end({ timeout: 2 }); }
    expect(other.major).toBe(17);
    lab = await physicalCluster();
    expect(lab.system).not.toBe(other.system);
    // Keep the built-in template0 sealed; use the same enforced copy boundary
    // as every other test provisioner. Never reopen this built-in template.
    await sealTemplate(statement => lab.admin.unsafe(statement), 'template0');
    for (const [kind, name] of Object.entries(ROLES)) await lab.admin.unsafe(`CREATE ROLE ${name} ${['migrator', 'runtime', 'auditor'].includes(kind) ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await lab.admin`GRANT lumi_backend_owner,lumi_canonical_owner TO lumi_backend_migrator`;
    await lab.admin`GRANT lumi_canonical_app TO lumi_backend_runtime`;
    await lab.admin`GRANT EXECUTE ON FUNCTION pg_control_system() TO lumi_backend_migrator`;
  }, 30000);
  afterAll(async () => {
    diagnosticDeadline = performance.now() + 12000; diagnosticRemainingMs = 2000; // within the unchanged 15s hook
    for (const q of clients.reverse()) await q.end({ timeout: 2 }).catch(() => {});
    for (const c of clusters.reverse()) c.stop();
    for (const dir of certificateDirs) rmSync(dir, { recursive: true, force: true });
    for (const dir of commandDirs) rmSync(dir, { recursive: true, force: true });
    console.info('FRESH_TARGET_LABS_STOPPED', clusters.length);
  }, 15000);
  async function target(encoding = 'UTF8') {
    const name = 'lumi_fresh_test_' + randomUUID().replaceAll('-', '').slice(0, 24);
    if (!['UTF8', 'SQL_ASCII'].includes(encoding)) throw Error('Unknown synthetic encoding');
    await lab.admin.unsafe(`CREATE DATABASE "${name}" OWNER ${ROLES.owner} TEMPLATE template0 ENCODING '${encoding}' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const q = lab.open(name, 'lab_fresh_admin');
    await q.unsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await q.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO ${ROLES.migrator}`);
    const [i] = await q`SELECT (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid,host(inet_server_addr()) AS address,inet_server_port() AS port`;
    await q.end();
    const approval = { version: 1, operation: 'PROVISION_EMPTY_PG17', expiresAt: Date.now() + 3600000, artifactSha256: loadFreshContract().artifactSha256,
      target: { host: '127.0.0.1', port: lab.port, database: name, login: ROLES.migrator, serverAddress: i.address, serverPort: i.port, systemIdentifier: lab.system, databaseOid: i.oid, platformOwner: 'lab_fresh_admin' } };
    return { approval, approvalSha256: digest(JSON.stringify(approval)), url: `postgresql://${ROLES.migrator}@127.0.0.1:${lab.port}/${name}`, caPem: undefined };
  }
  const reseal = r => { r.approvalSha256 = digest(JSON.stringify(r.approval)); return r; };
  const inventory = async r => {
    const q = lab.open(r.approval.target.database, 'lab_fresh_admin');
    try { return await q`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`; } finally { await q.end(); }
  };
  it('refuses a different physical cluster identity before DDL', async () => {
    const r = await target(); r.approval.target.systemIdentifier = other.system; reseal(r);
    expect((await provisionFreshTarget(r)).reason).toBe('IDENTITY_MISMATCH'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses an unsupported database encoding before DDL', async () => {
    const r = await target('SQL_ASCII');
    expect((await provisionFreshTarget(r)).reason).toBe('DATABASE_LOCALE_UNQUALIFIED'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses a conflicting preexisting table and an unreferenced domain before DDL', async () => {
    for (const ddl of ['CREATE TABLE marcom_sessions(id int)', 'CREATE DOMAIN unapproved_domain AS text']) {
      const r = await target(); const q = lab.open(r.approval.target.database, 'lab_fresh_admin'); await q.unsafe(ddl); await q.end();
      const before = await inventory(r); expect((await provisionFreshTarget(r)).reason).toBe('TARGET_NOT_EMPTY'); expect(await inventory(r)).toEqual(before);
    }
  });
  it('refuses excess runtime role privileges and unauthorized membership before DDL', async () => {
    const r = await target();
    await lab.admin`ALTER ROLE lumi_backend_runtime CREATEROLE`;
    try { expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); } finally { await lab.admin`ALTER ROLE lumi_backend_runtime NOCREATEROLE`; }
    await lab.admin`GRANT lumi_backend_owner TO lumi_backend_runtime`;
    try { expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); } finally { await lab.admin`REVOKE lumi_backend_owner FROM lumi_backend_runtime`; }
    expect(await inventory(r)).toEqual([]);
  });
  it('refuses excess PUBLIC database grants before DDL', async () => {
    const r = await target(), name = r.approval.target.database;
    await lab.admin.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO PUBLIC`);
    expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_DATABASE_ACL_MISMATCH'); expect(await inventory(r)).toEqual([]);
  });
  it('refuses direct sensitive system-function grants and foreign default privileges before DDL', async () => {
    const r = await target(), q = lab.open(r.approval.target.database, 'lab_fresh_admin');
    await q`GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO lumi_backend_runtime`;
    await q.end();
    expect((await provisionFreshTarget(r)).reason).toBe('BOOTSTRAP_SYSTEM_PRIVILEGE_MISMATCH'); expect(await inventory(r)).toEqual([]);
    const next = await target(), defaults = lab.open(next.approval.target.database, 'lab_fresh_admin');
    await defaults`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO lumi_backend_runtime`; await defaults.end();
    expect((await provisionFreshTarget(next)).reason).toBe('BOOTSTRAP_ROLE_PROFILE_MISMATCH'); expect(await inventory(next)).toEqual([]);
  });
  it('provisions exact76 receipts plus all4 legacy tables and the combined authority profile', async () => {
    valid = await target();
    const result = await provisionFreshTarget(valid);
    console.info('FRESH_PROVISION_RESULT', JSON.stringify(result));
    if (result.mismatch) {
      const q = lab.open(valid.approval.target.database, ROLES.migrator);
      const actual = await q.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectCombinedCatalog(tx); });
      for (const key of result.mismatch) {
        const expected = loadFreshContract().profile.catalog[key];
        console.info('FRESH_PROFILE_DIFFERENCE', JSON.stringify({ key,
          actual: actual[key].filter(x => !expected.some(y => JSON.stringify(x) === JSON.stringify(y))).slice(0, 2),
          expected: expected.filter(x => !actual[key].some(y => JSON.stringify(x) === JSON.stringify(y))).slice(0, 2) }));
      }
      await q.end();
    }
    expect(result).toMatchObject({ status: 'PROVISIONED_MATCH', runtimeAdmission: 'NOT_WIRED' });
    db = lab.open(valid.approval.target.database, ROLES.migrator);
    const native = await db.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectCombinedCatalog(tx); });
    expect(stable(bindPlatform(native, 'lab_fresh_admin'))).toEqual(stable(loadFreshContract().profile.catalog));
    const frozen = JSON.parse(readFileSync(new URL('../../scripts/legacy-schema/manifest.v2.json', import.meta.url)));
    const legacy = await db.begin('read only', async tx => { await tx`SET LOCAL search_path=pg_catalog,pg_temp`; return collectStructure(tx); });
    const expected = bind(frozen.catalog, { owner: ROLES.owner, runtime: ROLES.runtime, auditor: ROLES.auditor });
    for (const key of Object.keys(legacy)) expect(stable(legacy[key]), key).toEqual(stable(expected[key]));
    expect(await verifyCanonicalProvenanceCatalog(db)).toMatchObject({ status: 'PASS' });
    const rows = await db`SELECT migration_name,checksum,applied_steps_count FROM _prisma_migrations`;
    expect(rows).toHaveLength(76);
    for (const m of loadFreshContract().migrations) expect(rows.filter(r => r.migration_name === m.name && r.checksum === m.checksum && r.applied_steps_count === 1)).toHaveLength(1);
    await db.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  }, 30000);
  it('contains the trusted-TLS two-physical-target route before any connection or migration child', async () => {
    const second = await physicalCluster(); expect(second.system).not.toBe(lab.system);
    await sealTemplate(statement => second.admin.unsafe(statement), 'template0');
    for (const [kind, name] of Object.entries(ROLES)) await second.admin.unsafe(`CREATE ROLE ${name} ${['migrator', 'runtime', 'auditor'].includes(kind) ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await second.admin`GRANT lumi_backend_owner,lumi_canonical_owner TO lumi_backend_migrator`;
    await second.admin`GRANT lumi_canonical_app TO lumi_backend_runtime`;
    await second.admin`GRANT EXECUTE ON FUNCTION pg_control_system() TO lumi_backend_migrator`;
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-tls-')); certificateDirs.push(dir);
    const config = join(dir, 'openssl.cnf'), ca = join(dir, 'ca.crt'), cert = join(dir, 'server.crt'), key = join(dir, 'server.key');
    writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n');
    const env = { ...process.env, OPENSSL_CONF: config };
    const openssl = args => command(process.env.FRESH_TARGET_TEST_OPENSSL_BIN || 'openssl', args, env);
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=LUMI SYNTHETIC TEST CA',
      '-keyout', join(dir, 'ca.key'), '-out', ca, '-addext', 'basicConstraints=critical,CA:TRUE']);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', key, '-out', join(dir, 'server.csr')]);
    writeFileSync(join(dir, 'server.ext'), 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n');
    openssl(['x509', '-req', '-in', join(dir, 'server.csr'), '-CA', ca, '-CAkey', join(dir, 'ca.key'), '-CAcreateserial',
      '-days', '2', '-extfile', join(dir, 'server.ext'), '-out', cert]);
    await Promise.all([lab.enableTLS(cert, key), second.enableTLS(cert, key)]);
    const request = await target(), name = request.approval.target.database;
    await second.admin.unsafe(`CREATE DATABASE "${name}" OWNER ${ROLES.owner} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const bootstrap = second.open(name, 'lab_fresh_admin');
    await bootstrap.unsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await bootstrap.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO ${ROLES.migrator}`); await bootstrap.end();
    const caPem = readFileSync(ca, 'utf8');
    // Positive controls: both real endpoints authenticate TLS and their own
    // physical identity; the existing populated target still inspects over TLS.
    for (const physical of [lab, second]) {
      const q = postgres({ host: 'localhost', port: physical.port, database: name, username: ROLES.migrator,
        password: () => '', ssl: { rejectUnauthorized: true, ca: caPem }, max: 1, onnotice: () => {} }); clients.push(q);
      try {
        const [r] = await q`SELECT system_identifier::text AS system,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls FROM pg_control_system()`;
        expect(r).toEqual({ system: physical.system, tls: true });
      } finally { await q.end({ timeout: 2 }); }
    }
    const inspection = { ...valid, approval: { ...valid.approval, target: { ...valid.approval.target, host: 'localhost' } },
      url: valid.url.replace('127.0.0.1', 'localhost'), caPem }; reseal(inspection);
    expect((await inspectFreshTarget(inspection)).status).toBe('OBSERVED_MATCH');
    expect(migrationChildren.some(([, args]) => args.includes('migrate') && args.includes('deploy'))).toBe(true);
    const snapshot = async physical => {
      const q = physical.open(name, 'lab_fresh_admin');
      try { return await q.begin('read only', async tx => {
        await tx`SET LOCAL search_path=pg_catalog,pg_temp`;
        const catalog = await collectCombinedCatalog(tx);
        const receipts = catalog.tables.some(t => t.relname === '_prisma_migrations')
          ? await tx`SELECT to_jsonb(m) AS receipt FROM public._prisma_migrations m ORDER BY id` : [];
        return { catalog, receipts };
      }); } finally { await q.end(); }
    };
    const before = await Promise.all([snapshot(lab), snapshot(second)]);
    for (const state of before) { expect(state.catalog.tables).toEqual([]); expect(state.receipts).toEqual([]); }
    const routes = [], sockets = new Set(), servers = [];
    const accept = front => {
      const physical = routes.length === 0 ? lab : second;
      routes.push({ client: front.remoteAddress, listener: front.localAddress, system: physical.system });
      const back = net.connect({ host: '127.0.0.1', port: physical.port }); sockets.add(front); sockets.add(back);
      front.pipe(back); back.pipe(front); front.on('error', () => back.destroy()); back.on('error', () => front.destroy());
      front.on('close', () => { back.destroy(); sockets.delete(front); }); back.on('close', () => sockets.delete(back));
    };
    let port;
    try {
      for (const host of ['127.0.0.1', '::1']) {
        const server = net.createServer(accept); servers.push(server);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port: port || 0, ipv6Only: true }, resolve); });
        port = server.address().port;
      }
    } catch (error) {
      for (const socket of sockets) socket.destroy();
      for (const server of servers.filter(s => s.listening)) await new Promise(resolve => server.close(resolve));
      throw error;
    }
    request.approval.target.host = 'localhost'; request.approval.target.port = port;
    request.url = `postgresql://${ROLES.migrator}@localhost:${port}/${name}`; request.caPem = caPem; reseal(request);
    const childCount = migrationChildren.length, network = vi.spyOn(net.Socket.prototype, 'connect');
    let result, networkCalls;
    try { result = await provisionFreshTarget(request); networkCalls = network.mock.calls.length; }
    finally {
      network.mockRestore(); for (const socket of sockets) socket.destroy();
      for (const server of servers) await new Promise(resolve => server.close(resolve));
    }
    const after = await Promise.all([snapshot(lab), snapshot(second)]);
    console.info('FRESH_TLS_ROUTE_CONTAINMENT', JSON.stringify({ systems: [lab.system, second.system], routes, networkCalls,
      migrationChildren: migrationChildren.length - childCount, result, before: before.map(s => digest(JSON.stringify(stable(s)))),
      after: after.map(s => ({ digest: digest(JSON.stringify(stable(s))), tables: s.catalog.tables.map(t => t.relname), receipts: s.receipts })) }));
    expect(result).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT', runtimeAdmission: 'NOT_WIRED' });
    expect(networkCalls).toBe(0); expect(routes).toEqual([]); expect(migrationChildren).toHaveLength(childCount);
    expect(stable(after)).toEqual(stable(before));
  }, 30000);
  it('refuses repeated provisioning without changing receipts or creating application records', async () => {
    const q = lab.open(valid.approval.target.database, ROLES.migrator);
    const before = await q`SELECT to_jsonb(m) AS receipt FROM _prisma_migrations m ORDER BY id`;
    await q.end();
    expect((await provisionFreshTarget(valid)).status).toBe('REFUSED');
    const audit = lab.open(valid.approval.target.database, ROLES.auditor);
    expect(await audit`SELECT to_jsonb(m) AS receipt FROM _prisma_migrations m ORDER BY id`).toEqual(before);
    await expect(audit`SELECT * FROM marcom_credentials`).rejects.toMatchObject({ code: '42501' }); await audit.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('denies runtime DDL, receipt writes, truncation and owner/retention escalation', async () => {
    const q = lab.open(valid.approval.target.database, ROLES.runtime);
    for (const query of ['CREATE TABLE public.forbidden(id int)', 'DELETE FROM _prisma_migrations', 'TRUNCATE canonical_refreshes',
      'SET ROLE lumi_backend_owner', 'SET ROLE lumi_canonical_owner', 'SET ROLE lumi_canonical_retention', 'CREATE ROLE forbidden']) await expect(q.unsafe(query)).rejects.toMatchObject({ code: '42501' });
    await q.end();
  });
  it('preserves canonical tenant parent integrity under the actual runtime login', async () => {
    const owner = lab.open(valid.approval.target.database, 'lab_fresh_admin'), runtime = lab.open(valid.approval.target.database, ROLES.runtime);
    const a = await seed(owner), b = await seed(owner); const g = await admit(runtime, a); await level(runtime, g);
    await expect(level(runtime, { ...g, ws: b.ws })).rejects.toMatchObject({ code: '23503' });
    // RLS is deliberately not invented. Request authorization remains in the
    // existing middleware and its unchanged negative integration tests.
    for (const ws of [a.ws, b.ws]) { await owner`DELETE FROM workspaces WHERE id=${ws}`; await owner`DELETE FROM marcom_credentials WHERE workspace_id=${ws}`; }
    await runtime.end(); await owner.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('rejects changed column collation and UNLOGGED storage without hiding either drift', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`ALTER TABLE marcom_sessions ALTER COLUMN hybrid_raw_data TYPE text COLLATE "C"`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    await q`ALTER TABLE marcom_sessions ALTER COLUMN hybrid_raw_data TYPE text COLLATE "default"`;
    await q`ALTER TABLE marcom_user_context SET UNLOGGED`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    const [r] = await q`SELECT relpersistence FROM pg_class WHERE oid='marcom_user_context'::regclass`; expect(r.relpersistence).toBe('u');
    await q`ALTER TABLE marcom_user_context SET LOGGED`; await q.end();
    expect((await inspectFreshTarget(valid)).status).toBe('OBSERVED_MATCH');
  });
  it('fails exact qualification on extra grants and structural drift without repairing either', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`GRANT SELECT ON marcom_credentials TO PUBLIC`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    const [r] = await q`SELECT EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='marcom_credentials'::regclass AND a.grantee=0 AND a.privilege_type='SELECT') AS still_granted`; expect(r.still_granted).toBe(true);
    await q`REVOKE SELECT ON marcom_credentials FROM PUBLIC`; await q`ALTER TABLE marcom_sessions ADD COLUMN drift text`;
    expect((await inspectFreshTarget(valid)).reason).toBe('COMBINED_NATIVE_PROFILE_MISMATCH');
    await q.end();
  });
  it('rejects tampered receipts and preserves the failed history evidence', async () => {
    const q = lab.open(valid.approval.target.database, 'lab_fresh_admin');
    await q`UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='20261015000000_canonical_provenance_v1'`;
    expect((await inspectFreshTarget(valid)).reason).toBe('MIGRATION_HISTORY_MISMATCH');
    const [r] = await q`SELECT checksum FROM _prisma_migrations WHERE migration_name='20261015000000_canonical_provenance_v1'`; expect(r.checksum).toBe('0'.repeat(64)); await q.end();
  });
});

describe('owned Docker teardown / deterministic command and clock regression', () => {
  const ownedId = 'a'.repeat(64), otherId = 'b'.repeat(64);
  function fixture({ id = ownedId, initial = 'present', checks = ['absent'], fallback = 'absent', presence = '',
    stepMs = 10, deadline = 12000, remainingMs = 2000, stopError = false, psError = false,
    eventsError = false, lateProof = false, lateCompletion = false } = {}) {
    let tick = 0, inspections = 0;
    const calls = [], records = [], sequence = [...checks], budget = { deadline, remainingMs };
    const run = (_exe, rawArgs, options) => {
      const args = rawArgs.slice(2);
      calls.push({ args, timeout: options.timeout }); tick += stepMs;
      const response = (stdout = '', status = 0, stderr = '') => ({ stdout, status, stderr, signal: null });
      if (args[0] === 'stop') return response('', stopError ? 1 : 0, stopError ? 'simulated stop failure' : '');
      if (args[0] === 'ps') return response(presence, psError ? 1 : 0, psError ? 'simulated ps failure' : '');
      if (args[0] === 'version') return response('{"client":"28.0.4","server":"28.0.4"}');
      if (args[0] === 'events') return response('', eventsError ? 1 : 0, eventsError ? 'simulated event failure' : '');
      if (args[0] !== 'inspect' || args.at(-1) !== id) throw Error('Unscoped Docker observation');
      const state = inspections++ === 0 ? initial : sequence.shift() ?? fallback;
      if (lateProof && inspections > 1) tick = deadline;
      if (state === 'absent' || state === 'wrong-miss') return response('', 1, `Error: No such object: ${state === 'absent' ? id : otherId}`);
      if (state === 'error') return response('', 1, 'Cannot connect to the Docker daemon');
      if (state === 'timeout') return { ...response('', null), error: { code: 'ETIMEDOUT' }, signal: 'SIGKILL' };
      if (state === 'malformed') return response('{');
      return response(JSON.stringify({ id: state === 'wrong-id' ? otherId : id, image: `sha256:${'c'.repeat(64)}`,
        label: state === 'wrong-label' ? 'false' : 'true', autoRemove: true,
        created: '2026-10-25T00:00:00Z', startedAt: '2026-10-25T00:00:01Z', finishedAt: '2026-10-25T00:00:02Z',
        status: 'exited', running: false, dead: false, exitCode: 0 }));
    };
    const diagnostic = dockerLifecycleDiagnostic(id, { startedAt: '2026-10-25T00:00:00Z', exitCode: 0 },
      { run, now: () => tick, budget, emit: record => {
        records.push(record);
        if (lateCompletion && record.phase === 'teardown') tick = deadline;
      } });
    const docker = (args, observe) => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args], process.env, observe, run);
    return { calls, records, budget, stop: () => stopOwnedDockerContainer(id, docker, diagnostic) };
  }

  it('accepts delayed AutoRemove only after exact-owned-ID absence and preserves the immediate observation', () => {
    const f = fixture({ presence: ownedId.slice(0, 12), checks: ['present', 'present', 'absent'] });
    expect(f.stop).not.toThrow();
    const record = f.records.at(-1);
    expect(record.originalPresence).toBe(ownedId.slice(0, 12));
    expect(record.originalAssertion).toBe('FAIL');
    expect(record.cleanup.finalOwnedPresence).toBe(false);
    const stop = f.calls.findIndex(c => c.args[0] === 'stop');
    expect(f.calls[stop].args).toEqual(['stop', '-t', '5', ownedId]);
    expect(f.calls[stop + 1].args).toEqual(['ps', '-aq', '--filter', `id=${ownedId}`]);
    expect(f.calls.filter(c => c.args[0] === 'stop')).toHaveLength(1);
    expect(f.calls.every(c => ['stop', 'ps', 'inspect', 'events', 'version'].includes(c.args[0]))).toBe(true);
  });

  it('still accepts immediate removal with a hard final absence result', () => {
    const f = fixture(); expect(f.stop).not.toThrow();
    expect(f.records.at(-1).cleanup.finalOwnedPresence).toBe(false);
  });

  it('fails persistent presence with bounded read-only checks and no force removal', () => {
    const f = fixture({ presence: ownedId.slice(0, 12), checks: [], fallback: 'present', stepMs: 100 });
    expect(f.stop).toThrow();
    expect(f.calls.filter(c => c.args[0] === 'inspect').length).toBeLessThanOrEqual(21);
    expect(f.calls.some(c => ['rm', 'prune', 'kill'].includes(c.args[0]))).toBe(false);
  });

  for (const state of ['error', 'timeout', 'malformed', 'wrong-id', 'wrong-miss', 'wrong-label']) {
    it(`fails an inconclusive ${state} observation even when the immediate listing was empty`, () => {
      const f = fixture({ checks: [state] }); expect(f.stop).toThrow();
    });
  }

  it('fails unknown initial ownership before issuing stop', () => {
    const f = fixture({ initial: 'wrong-label' }); expect(f.stop).toThrow();
    expect(f.calls.some(c => c.args[0] === 'stop')).toBe(false);
  });
  it('fails an unqualified container ID without issuing stop', () => {
    const f = fixture({ id: ownedId.slice(0, 12) }); expect(f.stop).toThrow();
    expect(f.calls.some(c => c.args[0] === 'stop')).toBe(false);
  });
  it('fails when the existing deadline has expired', () => {
    const f = fixture({ deadline: 0 }); expect(f.stop).toThrow();
  });
  it('rejects an absence response delivered after the existing deadline', () => {
    const f = fixture({ lateProof: true }); expect(f.stop).toThrow();
  });
  it('refuses completion if the deadline expires after the final observation', () => {
    const f = fixture({ lateCompletion: true }); expect(f.stop).toThrow(/deadline or allowance expired/);
  });
  it('fails when the shared diagnostic allowance is exhausted', () => {
    const f = fixture({ checks: [], fallback: 'present', remainingMs: 50, stepMs: 20 }); expect(f.stop).toThrow();
  });
  it('does not turn a successful initial absence check into PASS when the final observation fails', () => {
    const f = fixture({ checks: ['absent', 'absent', 'absent', 'error'] }); expect(f.stop).toThrow();
  });
  it('records diagnostic command failure and refuses instead of treating it as absence', () => {
    const f = fixture({ eventsError: true }); expect(f.stop).toThrow();
  });
  it('preserves stop exit validation and the original failure over diagnostic failures', () => {
    const f = fixture({ stopError: true, checks: ['error'], fallback: 'error' });
    expect(f.stop).toThrow(/Fresh lab command failed: docker \(1\): simulated stop failure/);
    expect(f.calls.some(c => c.args[0] === 'ps')).toBe(false);
  });
  it('preserves immediate ps command failure even if later inspections find absence', () => {
    const f = fixture({ psError: true }); expect(f.stop).toThrow(/simulated ps failure/);
  });
});
