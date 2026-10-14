// A real API/worker boot probe against explicitly provisioned local fixtures.
// No ambient credentials or .env are permitted; queues use a new random prefix.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { assertVerificationRuntime } from './runtimeContract.js';

assertVerificationRuntime(process.version, 'backend runtime smoke');
const root = resolve(import.meta.dirname, '..');
if (existsSync(resolve(root, '.env'))) throw new Error('Runtime smoke refuses a checkout containing .env');
const legacy = process.argv.slice(2).join(' ') === '--legacy';
if (process.argv.length > 2 && !legacy) throw new Error('Expected no arguments or --legacy');
if (legacy && !existsSync(resolve(root, 'client/dist/index.html'))) throw new Error('Legacy smoke requires a built client');
function localFixture(key, protocol) {
  const url = new URL(process.env[key] || '');
  if (url.protocol !== protocol || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`${key} must name explicitly provisioned loopback infrastructure`);
  }
  return url;
}
const db = localFixture('SMOKE_DATABASE_URL', 'postgresql:');
if (!db.pathname.startsWith('/lumi_slice01_')) throw new Error('SMOKE_DATABASE_URL must name a dedicated lumi_slice01_* database');
db.searchParams.set('sslmode', 'disable');
const redis = localFixture('SMOKE_REDIS_URL', 'redis:');
const privateKey = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({type: 'pkcs8', format: 'pem'});
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, {
  DATABASE_URL: db.href, DIRECT_URL: db.href, CHECKPOINT_DISABLE: '1',
  ANTHROPIC_API_KEY: 'synthetic-unused', WEBHOOK_SECRET: 'w'.repeat(64),
  OAUTH_STATE_SECRET: 'o'.repeat(64), CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({project_id: 'lumi-slice01-synthetic', client_email: 'fixture@example.invalid', private_key: privateKey}),
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:59099', LOG_LEVEL: 'info',
  PORT: process.env.SMOKE_PORT || '53171', ALLOWED_ORIGINS: 'http://localhost:53171',
  BULLMQ_PREFIX: `lumi-slice01-${randomUUID()}`,
});

async function probe(kind) {
  const childEnv = {...env, NODE_ENV: kind === 'api' ? 'production' : 'test', REDIS_URL: kind === 'api' ? '' : redis.href};
  if (!legacy) childEnv.SERVE_FRONTEND = 'false';
  const child = spawn(process.execPath, [kind === 'api' ? 'src/server.js' : 'src/workers/index.js'], {cwd: root, env: childEnv});
  let output = '', exited = false;
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => output += b);
  child.on('exit', () => exited = true);
  try {
    const marker = kind === 'api' ? 'MARCOM v4 online' : '[worker] all workers online';
    for (let i = 0; i < 300 && !exited && !output.includes(marker); i++) await new Promise(r => setTimeout(r, 100));
    if (!output.includes(marker)) throw new Error(`${kind} did not boot\n${output}`);
    if (kind === 'api') {
      for (const [path, status] of [
        ['/api/health', 200], ['/health', 200], ['/api/__slice01_missing', 401],
        ['/webhook/__slice01_missing', 401], ['/app/__slice01_missing', legacy ? 200 : 404],
      ]) {
        const response = await fetch(`http://127.0.0.1:${env.PORT}${path}`);
        const body = await response.text();
        if (response.status !== status) throw new Error(`${path}: expected ${status}, got ${response.status}: ${body}`);
        if (path.startsWith('/api/') && !response.headers.get('content-type')?.includes('application/json')) throw new Error(`${path} returned a UI response`);
        if (path === '/health' && JSON.parse(body).db !== true) throw new Error('DB health failed');
        console.log(`${kind} ${path}: ${response.status}`);
      }
    } else {
      await new Promise(r => setTimeout(r, 1000));
      if (!output.includes('[worker] campaign sync scheduled') || /ECONNREFUSED|Unhandled|TypeError/.test(output)) throw new Error(`Worker/Redis boot failed\n${output}`);
    }
    console.log(`${kind} boot verified (${kind === 'worker' ? 'isolated Redis, NODE_ENV=test' : 'NODE_ENV=production'}; synthetic Firebase identity only)`);
  } finally { child.kill('SIGTERM'); }
}

await probe('api');
await probe('worker');
