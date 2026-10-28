import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { randomUUID, randomBytes, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, openSync, closeSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { provisionFreshTarget, inspectFreshTarget } from '../../scripts/fresh-target/provision.js';
import { loadFreshContract, digest, ROLES } from '../../scripts/fresh-target/contract.js';
import { collectCombinedCatalog, stable, bindPlatform } from '../../scripts/fresh-target/catalog.js';
import { collectStructure } from '../../scripts/legacy-schema/catalog.js';
import { bind } from '../../scripts/legacy-schema/contract.js';
import { verifyCanonicalProvenanceCatalog } from '../../scripts/verify-canonical-provenance-catalog.js';
import { seed, admit, level } from './canonicalProvenanceFixtures.js';
import { sealTemplate } from './dbIsolation.js';

const migrationChildren = vi.hoisted(() => []);
const writerControl = vi.hoisted(() => ({ beforeSpawn: null, afterSpawn: null }));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal();
  return { ...original, spawn(...args) {
    writerLifetime.assertOpen();
    migrationChildren.push(args); writerControl.beforeSpawn?.(...args);
    // A test-owned process group also owns the CLI's native engine on Linux.
    // Windows cancellation uses the exact still-live child's process tree.
    if (process.platform !== 'win32') args[2] = { ...args[2], detached: true };
    const child = original.spawn(...args); writerLifetime.track(child);
    writerControl.afterSpawn?.(child); return child;
  } };
});

function writerOwnership(terminate = child => {
  if (!Number.isInteger(child.pid) || child.pid <= 0) throw Error('Unqualified writer PID');
  if (process.platform === 'win32') {
    const result = spawnSync(join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { timeout: 1000, windowsHide: true, encoding: 'utf8' });
    if (result.error || result.signal || result.status !== 0) throw Error('Owned writer tree termination failed');
  } else process.kill(-child.pid, 'SIGKILL');
}) {
  let stopped = false, stopPromise;
  const records = [];
  const assertOpen = () => { if (stopped) throw Error('Writer lifetime ended'); };
  const track = child => {
    assertOpen();
    const record = { child, closed: false };
    record.done = new Promise(resolve => child.once('close', () => { record.closed = true; resolve(); }));
    records.push(record);
  };
  const wait = async deadline => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw Error('Writer cleanup deadline expired');
    let timer;
    try {
      await Promise.race([Promise.all(records.map(r => r.done)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Owned writer did not close')), remaining);
      })]);
    } finally { clearTimeout(timer); }
    if (records.some(r => !r.closed)) throw Error('Owned writer remains active');
  };
  return { assertOpen, track, wait, stop(deadline) {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      const pending = records.filter(r => !r.closed);
      for (const { child } of pending) terminate(child);
      await wait(deadline);
      return { children: records.length, terminated: pending.length, allClosed: true };
    })();
    return stopPromise;
  } };
}
const writerLifetime = writerOwnership();

describe('owned Prisma writer lifetime', () => {
  it('terminates only a live owned writer and awaits its close before teardown', async () => {
    const terminate = vi.fn(), owner = writerOwnership(terminate);
    const child = new EventEmitter(); child.pid = 123;
    owner.track(child);
    const stopped = owner.stop(performance.now() + 1000);
    expect(terminate).toHaveBeenCalledExactlyOnceWith(child);
    expect(() => owner.assertOpen()).toThrow('Writer lifetime ended');
    let closed = false; stopped.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    expect(owner.stop(performance.now() + 1000)).toBe(stopped);
    child.emit('close', null, 'SIGKILL');
    expect(await stopped).toEqual({ children: 1, terminated: 1, allClosed: true });
  });
  it('does not terminate an already closed writer', async () => {
    const terminate = vi.fn(), owner = writerOwnership(terminate), child = new EventEmitter();
    owner.track(child); child.emit('close', 0, null);
    expect(await owner.stop(performance.now() + 1000)).toEqual({ children: 1, terminated: 0, allClosed: true });
    expect(terminate).not.toHaveBeenCalled();
  });
  it('refuses teardown when owned-tree termination fails', async () => {
    const owner = writerOwnership(() => { throw Error('owned tree still active'); });
    const child = new EventEmitter(); owner.track(child);
    await expect(owner.stop(performance.now() + 1000)).rejects.toThrow('owned tree still active');
    expect(() => owner.assertOpen()).toThrow('Writer lifetime ended');
    child.emit('close', 1, null);
  });
  it('does not accept cleanup after its deadline', async () => {
    const owner = writerOwnership(vi.fn());
    await expect(owner.stop(performance.now() - 1)).rejects.toThrow('Writer cleanup deadline expired');
  });
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
const labSecret = randomBytes(32).toString('hex');
let labCertificate;
const evidence = (name, value) => {
  const bytes = JSON.stringify(value, null, 2);
  if (process.env.FRESH_TARGET_TEST_EVIDENCE_DIR) {
    writeFileSync(join(process.env.FRESH_TARGET_TEST_EVIDENCE_DIR, name + '.json'), bytes);
    // The complete raw record is already durable. Avoid sending megabytes of
    // the same catalog/server evidence through the Vitest worker IPC as well.
    console.info('P0_PHYSICAL_TARGET', JSON.stringify({ name, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) }));
  } else console.info('P0_PHYSICAL_TARGET', JSON.stringify({ name, ...value }));
};
function certificate(identity) {
  const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-tls-')); certificateDirs.push(dir);
  const config = join(dir, 'openssl.cnf'), ca = join(dir, 'ca.crt'), cert = join(dir, 'server.crt'), key = join(dir, 'server.key');
  writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  const env = { ...process.env, OPENSSL_CONF: config };
  const openssl = args => command(process.env.FRESH_TARGET_TEST_OPENSSL_BIN || 'openssl', args, env);
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=LUMI SYNTHETIC ' + identity + ' CA',
    '-keyout', join(dir, 'ca.key'), '-out', ca, '-addext', 'basicConstraints=critical,CA:TRUE']);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', key, '-out', join(dir, 'server.csr')]);
  writeFileSync(join(dir, 'server.ext'), 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n');
  openssl(['x509', '-req', '-in', join(dir, 'server.csr'), '-CA', ca, '-CAkey', join(dir, 'ca.key'), '-CAcreateserial',
    '-days', '2', '-extfile', join(dir, 'server.ext'), '-out', cert]);
  return { dir, cert, key, caPem: readFileSync(ca, 'utf8') };
}
function exclusiveRequest(request, physical, policy) {
  const contract = loadFreshContract();
  const binaries = new URL('../../node_modules/@prisma/engines/', import.meta.url);
  const engineName = process.platform === 'win32' ? 'schema-engine-windows.exe'
    : readdirSync(binaries).find(n => /^schema-engine-/.test(n) && !n.endsWith('.exe'));
  const qualification = { version: 1, scope: 'OWNED_SYNTHETIC_PG17_ONLY', target: request.approval.target,
    artifactSha256: contract.artifactSha256, caSha256: digest(request.caPem), credentialSha256: digest(labSecret),
    cliSha256: digest(readFileSync(new URL('../../node_modules/prisma/build/index.js', import.meta.url))),
    engineSha256: digest(readFileSync(new URL(engineName, binaries))), engineRevision: '605197351a3c8bdd595af2d2a9bc3025bca48ea2',
    networkPolicySha256: digest(JSON.stringify({ system: physical.system, policy })),
    // The fixture is the independently controlled owner of the synthetic HBA,
    // certificates, credentials and route; this record is NOT hosted evidence.
    evidenceSha256: digest(JSON.stringify({ physical: physical.system, policy, source: contract.artifactSha256 })) };
  const file = join(labCertificate.dir, randomUUID() + '.qualification.json');
  const bytes = JSON.stringify(qualification); writeFileSync(file, bytes);
  request.approval.exclusiveTarget = { version: 1, scope: qualification.scope, qualificationFile: file, qualificationSha256: digest(bytes) };
  request.approvalSha256 = digest(JSON.stringify(request.approval));
  return request;
}
async function observedCertificate(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }); let secure;
    const timer = setTimeout(() => { socket.destroy(); secure?.destroy(); reject(Error('TLS observation timeout')); }, 1000);
    const fail = error => { clearTimeout(timer); socket.destroy(); secure?.destroy(); reject(error); };
    socket.once('error', fail);
    socket.once('connect', () => socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])));
    socket.once('data', bytes => {
      if (bytes[0] !== 83) return fail(Error('TLS unavailable'));
      // Owned fixture observation only. Real operator/Prisma clients ALWAYS
      // validate the pinned CA; this probe grants no write authorization.
      secure = tls.connect({ socket, rejectUnauthorized: false }, () => {
        const fingerprint = secure.getPeerCertificate().fingerprint256;
        clearTimeout(timer); secure.destroy(); resolve(fingerprint);
      }); secure.once('error', fail);
    });
  });
}
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
  writerLifetime.assertOpen();
  const bin = process.env.FRESH_TARGET_TEST_PG_BIN;
  let port, stop, physicalEvidence, certificatePaths, configureHba, serverLog;
  if (bin) {
    if (!command(join(bin, 'postgres'), ['--version']).includes(' 17.')) throw Error('PG17 binary required');
    const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-pg17-')); port = await freePort();
    writerLifetime.assertOpen();
    command(join(bin, 'initdb'), ['-D', join(dir, 'data'), '-U', 'lab_fresh_admin', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    stop = () => { command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']); expect(existsSync(join(dir, 'data', 'postmaster.pid'))).toBe(false); };
    clusters.push({ stop });
    command(join(bin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    physicalEvidence = { physicalDirectory: dir, physicalControl: command(join(bin, 'pg_controldata'), [join(dir, 'data')]) };
    certificatePaths = (cert, key) => ({ cert, key });
    configureHba = text => writeFileSync(join(dir, 'data', 'pg_hba.conf'), text);
    serverLog = () => readFileSync(join(dir, 'postgres.log'), 'utf8');
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
    physicalEvidence = { container: id, image: docker(['inspect', '--format', '{{.Image}}', id]) };
    configureHba = text => {
      const dir = mkdtempSync(join(tmpdir(), 'lumi-fresh-hba-')); certificateDirs.push(dir);
      const file = join(dir, 'pg_hba.conf'); writeFileSync(file, text);
      docker(['cp', file, `${id}:/var/lib/postgresql/data/pg_hba.conf`]);
    };
    serverLog = () => {
      if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Unqualified owned Docker ID');
      // docker logs preserves the container's stdout/stderr stream split;
      // stock PostgreSQL writes its SQL/authentication records to stderr.
      const r = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', 'logs', id],
        { encoding: 'utf8', timeout: 20000, maxBuffer: 8388608, windowsHide: true });
      if (r.error || r.signal || r.status !== 0) throw Error('Owned Docker log observation failed');
      return (r.stdout ?? '') + (r.stderr ?? '');
    };
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
  writerLifetime.assertOpen();
  const [identity] = await admin`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`;
  expect(identity.major).toBe(17);
  if (bin) expect(physicalEvidence.physicalControl).toContain(identity.system);
  console.info('FRESH_TARGET_PHYSICAL_LAB', JSON.stringify({ port, ...identity, ...physicalEvidence }));
  const open = (database, username) => { const q = postgres({ host: '127.0.0.1', port, database, username, password: () => username === ROLES.migrator ? labSecret : '',
    ssl: username === ROLES.migrator && labCertificate ? { rejectUnauthorized: true, ca: labCertificate.caPem } : false, max: 1, onnotice: () => {} }); clients.push(q); return q; };
  const enableTLS = async (cert, key) => {
    const paths = certificatePaths(cert, key), literal = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "''") + "'";
    await admin.unsafe(`ALTER SYSTEM SET ssl_cert_file=${literal(paths.cert)}`);
    await admin.unsafe(`ALTER SYSTEM SET ssl_key_file=${literal(paths.key)}`);
    await admin`ALTER SYSTEM SET ssl='on'`; await admin`SELECT pg_reload_conf()`;
    const until = Date.now() + 10000;
    const fingerprint = new X509Certificate(readFileSync(cert)).fingerprint256;
    while (Date.now() < until) {
      try { if (await observedCertificate(port) === fingerprint) return; } catch { /* bounded reload observation */ }
    }
    throw Error('Owned lab TLS reload did not complete');
  };
  const restrict = async allow => {
    const [address] = await admin`SELECT host(inet_client_addr()) AS source`;
    const source = bin ? '127.0.0.0/8' : address.source + '/32';
    const policy = `hostssl all ${ROLES.migrator} ${source} ${allow ? 'scram-sha-256' : 'reject'}\nhost all ${ROLES.migrator} 0.0.0.0/0 reject\nhost all ${ROLES.migrator} ::0/0 reject\nhost all lab_fresh_admin 0.0.0.0/0 trust\nhost all all ${source} trust\n`;
    configureHba(policy); await admin`SELECT pg_reload_conf()`;
    return policy;
  };
  return { admin, port, system: identity.system, open, enableTLS, restrict, serverLog };
}

describe.skipIf(!enabled)('fresh PG17 operator / independent physical labs', () => {
  let lab, other, valid, db, qualifiedResult, second, secondSecret, otherCertificate, secondPolicy, setupWork, matrixWork;
  beforeAll(async () => {
    setupWork = (async () => {
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
    labCertificate = certificate('A');
    await lab.enableTLS(labCertificate.cert, labCertificate.key);
    await lab.admin.unsafe(`ALTER ROLE ${ROLES.migrator} PASSWORD '${labSecret}'`);
    lab.policy = await lab.restrict(true);
    // Fixture preparation has its own existing 30s hook. This increases the
    // total qualification wall clock; it is not the old end-to-end 30s budget.
    // No migration or native writer is run or prewarmed here.
    second = await physicalCluster();
    await sealTemplate(statement => second.admin.unsafe(statement), 'template0');
    for (const [kind, name] of Object.entries(ROLES)) await second.admin.unsafe(`CREATE ROLE ${name} ${['migrator', 'runtime', 'auditor'].includes(kind) ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await second.admin`GRANT lumi_backend_owner,lumi_canonical_owner TO lumi_backend_migrator`;
    await second.admin`GRANT lumi_canonical_app TO lumi_backend_runtime`;
    await second.admin`GRANT EXECUTE ON FUNCTION pg_control_system() TO lumi_backend_migrator`;
    secondSecret = randomBytes(32).toString('hex');
    await second.admin.unsafe(`ALTER ROLE ${ROLES.migrator} PASSWORD '${secondSecret}'`);
    otherCertificate = certificate('B');
    await second.enableTLS(labCertificate.cert, labCertificate.key);
    secondPolicy = await second.restrict(true);
    })();
    return setupWork;
  }, 30000);
  afterAll(async () => {
    diagnosticDeadline = performance.now() + 12000; diagnosticRemainingMs = 2000; // within the unchanged 15s hook
    const started = performance.now();
    // Vitest timeouts do not cancel an async test. End and await the exact
    // owned CLI/engine tree before its route or physical targets can disappear.
    const writerState = await writerLifetime.stop(diagnosticDeadline);
    console.info('P0_WRITERS_STOPPED', JSON.stringify(writerState));
    if (setupWork || matrixWork) {
      let timer;
      try {
        await Promise.race([Promise.all([setupWork?.catch(() => {}), matrixWork?.catch(() => {})]), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Fixture or matrix work survived teardown')), Math.max(0, diagnosticDeadline - performance.now()));
        })]);
      } finally { clearTimeout(timer); }
    }
    await Promise.all(clients.map(q => q.end({ timeout: 2 }).catch(() => {})));
    console.info('P0_PROVISION_TEARDOWN_TIMING', JSON.stringify({ phase: 'clients', elapsedMs: performance.now() - started }));
    for (const [index, c] of [...clusters].reverse().entries()) {
      const tick = performance.now(); c.stop();
      console.info('P0_PROVISION_TEARDOWN_TIMING', JSON.stringify({ phase: 'cluster', index, elapsedMs: performance.now() - tick, totalMs: performance.now() - started }));
    }
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
    return exclusiveRequest({ approval, approvalSha256: digest(JSON.stringify(approval)), url: `postgresql://${ROLES.migrator}:${labSecret}@127.0.0.1:${lab.port}/${name}`, caPem: labCertificate.caPem }, lab, lab.policy);
  }
  const reseal = r => {
    if (r.approval.exclusiveTarget) {
      const b = r.approval.exclusiveTarget, record = JSON.parse(readFileSync(b.qualificationFile));
      record.target = r.approval.target;
      const bytes = JSON.stringify(record); writeFileSync(b.qualificationFile, bytes); b.qualificationSha256 = digest(bytes);
    }
    r.approvalSha256 = digest(JSON.stringify(r.approval)); return r;
  };
  const inventory = async r => {
    const q = lab.open(r.approval.target.database, 'lab_fresh_admin');
    try { return await q`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`; } finally { await q.end(); }
  };
  it('refuses substituted credentials, trust and executable seals before opening a socket', async () => {
    const approved = await target();
    for (const mutation of ['credential', 'trust', 'engineSha256', 'cliSha256', 'networkPolicySha256']) {
      const request = { ...approved, approval: structuredClone(approved.approval) };
      const binding = request.approval.exclusiveTarget, original = readFileSync(binding.qualificationFile, 'utf8');
      if (mutation === 'credential') request.url = request.url.replace(labSecret, 'f'.repeat(64));
      else if (mutation === 'trust') request.caPem += '\nchanged';
      else {
        const q = JSON.parse(original); q[mutation] = '0'.repeat(64);
        const bytes = JSON.stringify(q); writeFileSync(binding.qualificationFile, bytes); binding.qualificationSha256 = digest(bytes);
      }
      request.approvalSha256 = digest(JSON.stringify(request.approval));
      const count = migrationChildren.length, network = vi.spyOn(net.Socket.prototype, 'connect');
      try {
        expect((await provisionFreshTarget(request)).status).toBe('REFUSED'); expect(network).not.toHaveBeenCalled();
        expect(migrationChildren).toHaveLength(count);
      } finally { network.mockRestore(); writeFileSync(binding.qualificationFile, original); }
    }
  });
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
  it('binds the actual Prisma writer under four adversarial routes and one qualified route', async () => {
    matrixWork = (async () => {
    const started = performance.now(), timings = []; let previous = started;
    const timing = phase => {
      const now = performance.now(); timings.push({ phase, elapsedMs: now - previous, totalMs: now - started }); previous = now;
      evidence('P0_TIMINGS', { timings });
    };
    writerLifetime.assertOpen();
    expect(second.system).not.toBe(lab.system);
    const request = await target(), name = request.approval.target.database;
    await second.admin.unsafe(`CREATE DATABASE "${name}" OWNER ${ROLES.owner} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    const bootstrap = second.open(name, 'lab_fresh_admin');
    await bootstrap.unsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await bootstrap.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO ${ROLES.migrator}`); await bootstrap.end();
    await second.admin`ALTER SYSTEM SET log_parameter_max_length=0`;
    await second.admin`ALTER SYSTEM SET log_parameter_max_length_on_error=0`;
    await second.admin`ALTER SYSTEM SET log_line_prefix='%m [%p] user=%u db=%d app=%a client=%h '`;
    await second.admin`ALTER SYSTEM SET log_statement='all'`; await second.admin`SELECT pg_reload_conf()`;
    // Log the actual matrix, including its first native invocation, without
    // logging unrelated preflight-regression work before the matrix starts.
    await lab.admin`ALTER SYSTEM SET log_parameter_max_length=0`;
    await lab.admin`ALTER SYSTEM SET log_parameter_max_length_on_error=0`;
    await lab.admin`ALTER SYSTEM SET log_line_prefix='%m [%p] user=%u db=%d app=%a client=%h '`;
    await lab.admin`ALTER SYSTEM SET log_statement='all'`; await lab.admin`SELECT pg_reload_conf()`;
    timing('matrix_bootstrap');
    const snapshot = async physical => {
      writerLifetime.assertOpen();
      const q = physical.open(name, 'lab_fresh_admin');
      try { return await q.begin('isolation level repeatable read read only', async tx => {
        await tx`SET LOCAL search_path=pg_catalog,pg_temp`;
        const [identity] = await tx`SELECT system_identifier::text AS system FROM pg_control_system()`;
        expect(identity.system).toBe(physical.system);
        const catalog = await collectCombinedCatalog(tx);
        const receipts = catalog.tables.some(t => t.relname === '_prisma_migrations')
          ? await tx`SELECT to_jsonb(m) AS receipt FROM public._prisma_migrations m ORDER BY id` : [];
        return { system: identity.system, catalog, receipts };
      }); } finally { await q.end(); }
    };
    const pair = async label => {
      // Targets are independent and the controlled writer is paused here.
      // Both still receive their own full read-only transaction/identity check.
      const [A, B] = await Promise.all([snapshot(lab), snapshot(second)]);
      const state = { A, B };
      evidence(label, state); return state;
    };
    const before = await pair('P0_INITIAL');
    timing('initial_catalogs');
    for (const state of Object.values(before)) { expect(state.catalog.tables).toEqual([]); expect(state.receipts).toEqual([]); }
    const routes = [], sockets = new Set(); let selected = lab, caseName = 'WITNESS';
    const server = net.createServer(front => {
      const physical = selected;
      const row = { case: caseName, system: physical.system, upstreamPort: physical.port, bytesFront: 0, bytesBack: 0 };
      routes.push(row);
      const back = net.connect({ host: '127.0.0.1', port: physical.port, localAddress: '127.0.0.2' });
      sockets.add(front); sockets.add(back);
      front.on('data', bytes => { row.bytesFront += bytes.length; }); back.on('data', bytes => { row.bytesBack += bytes.length; });
      front.pipe(back); back.pipe(front); front.on('error', () => back.destroy()); back.on('error', () => front.destroy());
      front.on('close', () => { back.destroy(); sockets.delete(front); }); back.on('close', () => sockets.delete(back));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    request.approval.target.port = port;
    request.url = `postgresql://${ROLES.migrator}:${labSecret}@127.0.0.1:${port}/${name}`;
    exclusiveRequest(request, lab, lab.policy);
    const witness = async physical => {
      selected = physical;
      const q = postgres({ host: '127.0.0.1', port, database: name, username: ROLES.migrator,
        password: () => physical === lab ? labSecret : secondSecret, ssl: { rejectUnauthorized: true, ca: labCertificate.caPem }, max: 1, onnotice: () => {} }); clients.push(q);
      try {
        const [r] = await q`SELECT system_identifier::text AS system,current_database() AS database,current_user AS login,
          (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls FROM pg_control_system()`;
        expect(r).toMatchObject({ system: physical.system, database: name, login: ROLES.migrator, tls: true }); return r;
      } finally { await q.end({ timeout: 2 }); }
    };
    const cases = [];
    try {
      const witnesses = [await witness(lab), await witness(second)];
      evidence('P0_CREDENTIAL_WITNESSES', { witnesses, distinctSecrets: labSecret !== secondSecret });
      timing('credential_witnesses');
      // Preserve containment even with trusted TLS and explicit seals.
      const contained = { ...request, approval: { ...request.approval, target: { ...request.approval.target, host: 'localhost' } }, url: request.url.replace('127.0.0.1', 'localhost') };
      reseal(contained);
      const childCount = migrationChildren.length, routeCount = routes.length;
      expect(await provisionFreshTarget(contained)).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_TARGET_BINDING_UNQUALIFIED', phase: 'INPUT' });
      expect(migrationChildren).toHaveLength(childCount); expect(routes).toHaveLength(routeCount);
      exclusiveRequest(request, lab, lab.policy);
      for (const [id, expected] of [['R1_CREDENTIAL', /P1000/], ['R2_TLS', /P1011/], ['R3_NETWORK', /P1010/], ['R4_PREFLIGHT_REDIRECT', /P1010/], ['G1_ACTUAL_PRISMA', null]]) {
        writerLifetime.assertOpen();
        if (id === 'R2_TLS') await second.enableTLS(otherCertificate.cert, otherCertificate.key);
        if (id === 'R3_NETWORK') {
          await second.enableTLS(labCertificate.cert, labCertificate.key); secondPolicy = await second.restrict(false);
        }
        caseName = id; selected = lab;
        const beforeCase = await pair(id + '_BEFORE'), routeStart = routes.length, childStart = migrationChildren.length;
        timing(id + '_before_catalogs');
        let output = '', actualExit, actualSignal;
        writerControl.beforeSpawn = (_exe, args, options) => {
          expect(args).toContain('migrate'); expect(args).toContain('deploy');
          const u = new URL(options.env.DATABASE_URL);
          expect(options.env.DATABASE_URL).toBe(options.env.DIRECT_URL);
          expect(u.hostname).toBe('127.0.0.1'); expect(Number(u.port)).toBe(port);
          expect(u.searchParams.get('sslmode')).toBe('require'); expect(u.searchParams.get('sslaccept')).toBe('strict');
          expect(digest(readFileSync(u.searchParams.get('sslcert')))).toBe(digest(labCertificate.caPem));
          expect(digest(readFileSync(options.env.PRISMA_SCHEMA_ENGINE_BINARY))).toBe(JSON.parse(readFileSync(request.approval.exclusiveTarget.qualificationFile)).engineSha256);
          for (const ambient of ['NODE_OPTIONS', 'PRISMA_MIGRATION_ENGINE_BINARY', 'PGHOST', 'PGPASSWORD', 'SSL_CERT_FILE']) expect(options.env).not.toHaveProperty(ambient);
          // Preflight's authenticated connection stays on A. Only the actual
          // native writer's newly opened sockets are redirected.
          selected = expected ? second : lab;
        };
        writerControl.afterSpawn = child => {
          child.stdout.on('data', bytes => { output += bytes.toString(); });
          child.stderr.on('data', bytes => { output += bytes.toString(); });
          child.once('close', (code, signal) => { actualExit = code; actualSignal = signal; });
        };
        let result;
        try { result = await provisionFreshTarget(request); }
        finally { writerControl.beforeSpawn = null; writerControl.afterSpawn = null; }
        writerLifetime.assertOpen();
        timing(id + '_writer');
        const afterCase = await pair(id + '_AFTER'), observed = routes.slice(routeStart);
        timing(id + '_after_catalogs');
        const safeOutput = output.replaceAll(labSecret, '<credential-A>').replaceAll(secondSecret, '<credential-B>');
        cases.push({ id, result, routes: observed, expectedError: expected?.source ?? null, actualExit, actualSignal, output: safeOutput });
        evidence('P0_CASES', { cases, serverSourcePolicy: secondPolicy });
        expect(migrationChildren.length - childStart).toBe(1);
        expect(observed[0].system).toBe(lab.system);
        expect(observed.slice(1).length).toBeGreaterThan(0);
        expect(observed.slice(1).every(r => r.system === (expected ? second.system : lab.system))).toBe(true);
        expect(actualSignal).toBeNull();
        if (expected) {
          expect(actualExit).toBe(1); expect(output).toMatch(expected);
          expect(result).toMatchObject({ status: 'REFUSED', reason: 'MIGRATION_PROCESS_FAILED', phase: 'MIGRATIONS' });
          expect(stable(afterCase)).toEqual(stable(beforeCase));
        } else {
          expect(actualExit).toBe(0);
          expect(result).toMatchObject({ status: 'PROVISIONED_MATCH', reason: 'EXACT_PROFILE_AND76_RECEIPTS' });
          expect(stable(bindPlatform(afterCase.A.catalog, 'lab_fresh_admin'))).toEqual(stable(loadFreshContract().profile.catalog));
          expect(afterCase.A.receipts).toHaveLength(76);
          for (const m of loadFreshContract().migrations) {
            const matches = afterCase.A.receipts.map(r => r.receipt).filter(r => r.migration_name === m.name);
            expect(matches).toHaveLength(1);
            expect(matches[0]).toMatchObject({ checksum: m.checksum, applied_steps_count: 1, rolled_back_at: null });
            expect(matches[0].finished_at).toBeTruthy(); expect(matches[0].logs || '').toBe('');
            expect(Date.parse(matches[0].finished_at)).toBeGreaterThanOrEqual(Date.parse(matches[0].started_at));
          }
        }
        expect(stable(afterCase.B)).toEqual(stable(before.B));
      }
      const logs = { A: lab.serverLog(), B: second.serverLog() };
      expect(logs.A).toMatch(/_prisma_migrations/);
      expect(logs.B).toMatch(/password authentication failed/); expect(logs.B).toMatch(/pg_hba.conf rejects/);
      expect(logs.B).not.toMatch(/(?:CREATE TABLE|INSERT INTO|UPDATE)\s+(?:"public"\.)?"?_prisma_migrations/i);
      evidence('P0_RAW_SERVER_LOGS', logs);
      timing('raw_server_logs');
    } finally {
      writerControl.beforeSpawn = null; writerControl.afterSpawn = null;
      await writerLifetime.wait(performance.now() + 2000);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      const closed = await new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', error => resolve(error.code === 'ECONNREFUSED')); });
      expect(closed).toBe(true); evidence('P0_ROUTE_TEARDOWN', { port, closed });
    }
    // The existing structural, tenant and permission regressions use this
    // very same real positive result. Do not migrate a second throwaway schema
    // merely to repeat the already-complete native deployment.
    // The adversarial route is now closed. The lab controller independently
    // seals the direct local endpoint to the SAME physical database for the
    // subsequent inspection, repeated-mutation refusal and permission tests.
    request.approval.target.port = lab.port;
    request.url = `postgresql://${ROLES.migrator}:${labSecret}@127.0.0.1:${lab.port}/${name}`;
    valid = exclusiveRequest(request, lab, lab.policy); qualifiedResult = cases.at(-1).result;
    timing('complete');
    })();
    return matrixWork;
  }, 30000);

  it('provisions exact76 receipts plus all4 legacy tables and the combined authority profile', async () => {
    expect(valid).toBeDefined();
    const result = qualifiedResult;
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
