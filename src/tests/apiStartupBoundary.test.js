import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const empty = () => ({ sockets: 0, listen: 0, queuesInit: 0, redisConnect: 0, config: 0,
  queues: 0, workers: 0, getDb: 0, sql: 0, signals: 0 });

// Fresh native Node processes avoid transforming the large cyclic route graph
// through Vitest. Real server/registry/model sources execute against inert route
// handlers and intercepted I/O. Full graph imports are verified separately.
// No synthetic result authorizes startup.
function runProbe(cli = false) {
  expect(existsSync(join(root, '.env')), 'Use an isolated checkout without .env').toBe(false);
  const temp = mkdtempSync(join(tmpdir(), 'lumi-api-refusal-'));
  const report = join(temp, 'calls.json');
  const preload = join(temp, 'guard.cjs');
  writeFileSync(preload, `
    const fs = require('node:fs'), net = require('node:net'), http = require('node:http');
    const { createRequire, registerHooks } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const req = createRequire(${JSON.stringify(join(root, 'package.json'))});
    const state = globalThis.__apiStartupProbe = { counts: ${JSON.stringify(empty())}, queueFailure: false, sqlFailure: false };
    const save = () => fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify(state));
    const hit = key => { state.counts[key]++; save(); };
    const deny = key => { hit(key); throw Error('API_FIXTURE_FORBIDDEN_' + key); };
    net.Socket.prototype.connect = () => deny('sockets');
    http.Server.prototype.listen = function(...args) {
      hit('listen');
      if (${cli}) throw Error('API_FIXTURE_LISTEN_FORBIDDEN');
      args.findLast(arg => typeof arg === 'function')?.(); return this;
    };
    const on = process.on.bind(process);
    process.on = (name, callback) => {
      if (['SIGTERM', 'SIGINT'].includes(name)) { hit('signals'); return process; }
      return on(name, callback);
    };
    const Redis = req('ioredis');
    Redis.prototype.connect = function() { hit('redisConnect'); this.status = 'ready'; return Promise.resolve(); };
    Redis.prototype.config = function() {
      hit('config');
      return state.queueFailure ? Promise.reject(Error('synthetic-queue-denied')) : Promise.resolve(['maxmemory-policy','noeviction']);
    };
    const bull = { ...req('bullmq') }; req.cache[req.resolve('bullmq')].exports = bull;
    bull.Queue = class {
      constructor() { hit('queues'); }
      on() { return this; } waitUntilReady() { return Promise.resolve(); }
      close() { return Promise.resolve(); } add() { return deny('queues'); }
    };
    bull.Worker = class { constructor() { deny('workers'); } };
    const dbUrl = pathToFileURL(${JSON.stringify(join(root, 'src/utils/db.js'))}).href;
    const queueUrl = pathToFileURL(${JSON.stringify(join(root, 'src/queues/index.js'))}).href;
    const serverUrl = pathToFileURL(${JSON.stringify(join(root, 'src/server.js'))});
    const routeStubs = new Map();
    for (const match of fs.readFileSync(serverUrl, 'utf8').matchAll(/^import\\s+(.+?)\\s+from\\s+['"](.\\/routes\\/[^'"]+)['"]/gm)) {
      const names = match[1].trim();
      const exports = names.startsWith('{')
        ? names.slice(1,-1).split(',').map(name => 'export const ' + name.trim() + '=Router();').join('')
        : 'export default Router();';
      routeStubs.set(new URL(match[2],serverUrl).href, "import {Router} from 'express';" + exports);
    }
    state.routesStubbed = routeStubs.size;
    registerHooks({ load(url, context, next) {
      if (routeStubs.has(url)) return { format:'module', shortCircuit:true, source:routeStubs.get(url) };
      if (url === dbUrl) return { format:'module', shortCircuit:true, source:
        'const s=globalThis.__apiStartupProbe; export function getDb(){s.counts.getDb++; return async()=>{s.counts.sql++; if(s.sqlFailure)throw Error("synthetic-DDL-denied"); return []}}; export async function closeDb(){}; export function isDbAvailable(){return true}' };
      const result = next(url, context);
      if (url === queueUrl) return { ...result, source: String(result.source).replace(
        'export async function initializeQueues() {',
        'export async function initializeQueues() { globalThis.__apiStartupProbe.counts.queuesInit++;') };
      return result;
    }});
    state.save = save; save(); process.on('exit', save);
  `);
  const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    NODE_ENV: 'production', PORT: '0', SERVE_FRONTEND: 'false', CHECKPOINT_DISABLE: '1',
    DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/definitely-not-a-database',
    ANTHROPIC_API_KEY: 'synthetic-key', WEBHOOK_SECRET: 'w'.repeat(40),
    OAUTH_STATE_SECRET: 'o'.repeat(40), CREDENTIAL_ENCRYPTION_KEY: 'c'.repeat(64),
    ...(cli ? {} : { REDIS_URL: 'redis://[::1]:6399' }),
  });
  const main = `
    const { startServer } = await import(${JSON.stringify(new URL('../server.js', import.meta.url).href)});
    const s = globalThis.__apiStartupProbe;
    s.importCounts = {...s.counts}; s.attempts = [];
    const inputs = [undefined, true, {admitted:true}, {status:'READY'},
      {status:'READY',scope:'SYNTHETIC_ONLY',runtimeAdmission:'NOT_WIRED'},
      {status:'OBSERVED_MATCH',scope:'LAB_CANONICAL_NATIVE_HISTORY_ONLY'},
      {status:'OBSERVED_MATCH',tenantPermissionBoundaries:'NOT_MEASURED'},
      () => { throw Error('CALLBACK_INVOKED'); },
      new Proxy({}, {get(){throw Error('HOSTILE_CLAIM_READ')}})];
    async function attempt(input) {
      s.counts = ${JSON.stringify(empty())};
      const result = await startServer(input).then(()=>({resolved:true}),e=>({code:e.code,message:e.message}));
      await new Promise(r=>setImmediate(r));
      return {result,counts:{...s.counts}};
    }
    for (const input of inputs) s.attempts.push(await attempt(input));
    process.env.NODE_ENV='development'; process.env.API_STARTUP_READY='true'; process.env.SKIP_STARTUP_ADMISSION='true';
    s.environment = await attempt();
    s.queueFailure=true; s.queueError = await attempt(); s.queueFailure=false;
    s.sqlFailure=true; s.sqlError = await attempt(); s.sqlFailure=false;
    s.repeated = await Promise.all([attempt(),attempt(),attempt()]);
    s.complete=true; s.save(); process.exit(0);
  `;
  try {
    const child = spawnSync(process.execPath, ['--require', preload, ...(cli ? ['src/server.js'] : ['--input-type=module', '-e', main])], {
      cwd: root, env, timeout: 3500, encoding: 'utf8', windowsHide: true,
    });
    const observed = JSON.parse(readFileSync(report, 'utf8'));
    console.info('API_STARTUP_OBSERVATION', JSON.stringify({ cli, status: child.status, signal: child.signal,
      error: child.error?.code, observed, stdout: child.stdout, stderr: child.stderr }));
    return { child, observed };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

let observed;
beforeAll(() => {
  const probe = runProbe();
  expect(probe.child.error, probe.child.stderr).toBeUndefined();
  expect(probe.child.status, probe.child.stderr).toBe(0);
  expect(probe.observed.routesStubbed).toBe(20);
  expect(probe.observed.complete).toBe(true);
  observed = probe.observed;
});
function expectRefused(attempt) {
  expect(attempt.counts).toEqual(empty());
  expect(attempt.result).toEqual({ code: 'API_ADMISSION_UNQUALIFIED', message: 'API_ADMISSION_UNQUALIFIED' });
}
describe('API startup refuses without real whole-process proof authority', () => {
  it('imports without listener, Redis, Queue, Worker, DB queries or automatic ensures', () => {
    expect(observed.importCounts).toEqual(empty());
  });
  it.each(Array.from({ length: 9 }, (_, i) => i))('refuses unqualified input/callback %i before any activation or SQL', i => {
    expectRefused(observed.attempts[i]);
  });
  it('does not promote environment flags or development mode into admission', () => { expectRefused(observed.environment); });
  it('never falls through to HTTP when configured Queue readiness would reject', () => { expectRefused(observed.queueError); });
  it('never invokes or swallows a failed legacy DDL attempt', () => { expectRefused(observed.sqlError); });
  it('repeated and concurrent calls remain refused without registering shutdown work', () => {
    for (const attempt of observed.repeated) expectRefused(attempt);
  });
  it('the actual CLI exits nonzero instead of remaining alive after refusal', () => {
    const { child, observed: cli } = runProbe(true);
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout + child.stderr).toContain('API_ADMISSION_UNQUALIFIED');
    expect(cli.counts).toEqual(empty());
  });
});
