// Real npm script dispatch, real migration entrypoints, inert compiler tools.
// This fixture proves command reachability; separate real builds prove compilation.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const npmCli = process.env.npm_execpath || [
  resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find(path => existsSync(path));
if (!npmCli) throw new Error('build boundary fixture requires an installed npm CLI');

export function buildFixture({ client = true, mutate } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lumi-build-boundary-'));
  const put = (path, data) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  mutate?.(pkg);
  put('package.json', JSON.stringify(pkg));
  cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true });
  // check/boot-check are real. Only their source subject is minimal and inert.
  put('src/server.js', "console.error('Missing required environment variables'); process.exit(1);\n");
  for (const name of ['runtime-contracts', 'api-contracts']) {
    put(`packages/${name}/package.json`, readFileSync(join(REPO, `packages/${name}/package.json`)));
  }
  if (client) {
    // Backend-only checkouts still exercise legacy script dispatch with an inert
    // client subject. Actual client compilation is a separate present-client gate.
    const manifest = join(REPO, 'client/package.json');
    put('client/package.json', existsSync(manifest) ? readFileSync(manifest)
      : JSON.stringify({ name: 'lumi-client', private: true, scripts: { build: 'vite build' } }));
  }
  const audit = join(root, 'audit.jsonl');
  const runner = join(root, 'tool.cjs');
  put('tool.cjs', `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const [tool, ...args] = process.argv.slice(2);
const log = (kind, detail) => fs.appendFileSync(process.env.BUILD_AUDIT, JSON.stringify({kind, detail})+'\\n');
const forbidden = detail => { log('FORBIDDEN', detail); console.error('BUILD_BOUNDARY_FORBIDDEN: '+detail); process.exit(86); };
if (['psql', 'pg_restore', 'createdb', 'dropdb'].includes(tool)) forbidden(tool+' '+args.join(' '));
if (tool === 'prisma') {
  log('prisma', args);
  if (args.length === 1 && args[0] === 'generate') process.exit(0);
  if (process.env.DIAGNOSTIC_FIXTURE === '1') {
    if (args.join(' ') === 'migrate status') { console.log('Database schema is up to date!'); process.exit(0); }
    if (args.join(' ') === 'migrate deploy') { console.error('P3009 failed migration fixture_76'); process.exit(1); }
  }
  forbidden('prisma '+args.join(' '));
}
if (tool === 'npx') {
  if (args[0] !== 'prisma') forbidden('npx '+args.join(' '));
  const r=spawnSync(process.execPath, [__filename, 'prisma', ...args.slice(1)], {stdio:'inherit'});
  process.exit(r.status ?? 1);
}
if (tool === 'vite') {
  if (args.join(' ') !== 'build') forbidden('vite '+args.join(' '));
  log('compiler-fixture', 'vite build'); fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/index.html', 'fixture'); process.exit(0);
}
if (tool === 'husky') { log('lifecycle', 'prepare'); process.exit(0); }
if (tool === 'npm') {
  if (['ci', 'install'].includes(args[0])) {
    // No registry access. Execute the real npm lifecycle runner for root hooks.
    log('install-fixture', args);
    for (const hook of ['preinstall','install','postinstall','prepublish','preprepare','prepare','postprepare']) {
      const r=spawnSync(process.execPath, [process.env.BUILD_NPM_CLI, 'run', hook, '--if-present'], {stdio:'inherit'});
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
    process.exit(0);
  }
  const r=spawnSync(process.execPath, [process.env.BUILD_NPM_CLI, ...args], {stdio:'inherit'});
  process.exit(r.status ?? 1);
}
forbidden('unknown tool '+tool);
`);
  put('network.cjs', `
const fs=require('node:fs');
require('node:net').Socket.prototype.connect = function () {
  fs.appendFileSync(process.env.BUILD_AUDIT, JSON.stringify({kind:'FORBIDDEN',detail:'network connect'})+'\\n');
  throw new Error('BUILD_BOUNDARY_FORBIDDEN: network connect');
};
`);
  // The actual legacy script imports postgres and dotenv. No real socket can open.
  put('node_modules/postgres/package.json', JSON.stringify({ type: 'module', exports: './index.js' }));
  put('node_modules/postgres/index.js', "import fs from 'node:fs'; export default function () { fs.appendFileSync(process.env.BUILD_AUDIT, JSON.stringify({kind:'FORBIDDEN',detail:'postgres constructor'})+'\\n'); throw new Error('BUILD_BOUNDARY_FORBIDDEN: postgres constructor'); }\n");
  put('node_modules/dotenv/package.json', JSON.stringify({ type: 'module', exports: { './config': './config.js' } }));
  put('node_modules/dotenv/config.js', '// No environment files in this fixture.\n');
  for (const tool of ['npm', 'npx', 'prisma', 'vite', 'husky', 'psql', 'pg_restore', 'createdb', 'dropdb']) {
    const win = `@echo off\r\n"${process.execPath}" "${runner}" ${tool} %*\r\n`;
    put(`node_modules/.bin/${tool}.cmd`, win);
    put(`node_modules/.bin/${tool}`, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${runner.replaceAll("'", "'\\''")}' ${tool} "$@"\n`);
    // Windows uses .cmd; POSIX needs the executable bit.
    if (process.platform !== 'win32') require('node:fs').chmodSync(join(root, `node_modules/.bin/${tool}`), 0o755);
  }
  const env = {
    // Explicit allowlist: never inherit provider credentials or database URLs.
    PATH: `${join(root, 'node_modules/.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    SystemRoot: process.env.SystemRoot, COMSPEC: process.env.COMSPEC,
    HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/build_forbidden?connect_timeout=1',
    DIRECT_URL: 'postgresql://fixture:fixture@127.0.0.1:1/build_forbidden?connect_timeout=1',
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
    BUILD_AUDIT: audit, BUILD_NPM_CLI: npmCli,
    NODE_OPTIONS: `--require "${join(root, 'network.cjs').replaceAll('\\', '/')}"`,
    MIGRATE_CONN_RETRIES: '1', MIGRATE_LOCK_RETRIES: '1',
    npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false',
  };
  spawnSync('git', ['init', '-q'], { cwd: root, env });
  spawnSync('git', ['add', 'src'], { cwd: root, env });
  return {
    root,
    run(args, extraEnv = {}) {
      writeFileSync(audit, '');
      const r = spawnSync(process.execPath, [npmCli, ...args], {
        cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 25_000,
      });
      return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`,
        events: readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
    close() { rmSync(root, { recursive: true, force: true }); },
  };
}
