import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixtures/buildBoundary.fixture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const blueprint = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
const BUILDS = ['npm ci --include=dev && npm run build', 'npm ci --include=dev && npm run build:worker'];

describe('03A build / operator migration boundary', () => {
  it('audits the ordinary script graph and every first-party install/build/start lifecycle hook', () => {
    // Reviewed command allowlist: a new edge must be reviewed, not regex-guessed safe.
    expect(pkg.scripts.build).toBe('npm run prisma:generate && npm run build:client');
    expect(pkg.scripts['build:backend']).toBe('npm run prisma:generate && npm run check && npm run boot-check');
    expect(pkg.scripts['build:worker']).toBe('npm run build:backend');
    expect(pkg.scripts['build:client']).toBe('npm run build --workspace client');
    expect(pkg.scripts['prisma:generate']).toBe('prisma generate');
    expect(pkg.scripts['install:backend']).toBe('npm ci --include=dev --workspace @marcom/runtime-contracts --workspace @marcom/api-contracts --include-workspace-root');
    expect(pkg.scripts.migrate).toBeUndefined();
    expect(pkg.scripts['build:migrate']).toBeUndefined();
    expect(pkg.scripts['db:migrate:deploy']).toBe('node scripts/prisma-migrate-safe.js');
    expect(pkg.scripts['db:migrate:legacy']).toBe('node scripts/migrate.js');
    const manifests = ['package.json', ...readdirSync(join(ROOT, 'packages')).map(p => `packages/${p}/package.json`)];
    if (existsSync(join(ROOT, 'client/package.json'))) manifests.push('client/package.json');
    const operations = ['install', 'ci', 'publish', 'prepare', 'start', 'worker', 'build', 'build:backend', 'build:worker', 'build:client', 'prisma:generate', 'install:backend'];
    const hooks = new Set(['install', 'prepare', ...operations.flatMap(op => [`pre${op}`, `post${op}`])]);
    for (const manifest of manifests) {
      const scripts = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8')).scripts || {};
      for (const [name, value] of Object.entries(scripts)) {
        if (!hooks.has(name)) continue;
        const allowed = manifest === 'package.json' ? { prepare: 'husky || true', prestart: 'npm run check' } : {};
        expect(value, `${manifest}: unexpected lifecycle ${name}`).toBe(allowed[name]);
      }
    }
    if (existsSync(join(ROOT, 'client/package.json'))) {
      expect(JSON.parse(readFileSync(join(ROOT, 'client/package.json'), 'utf8')).scripts.build).toBe('vite build');
    }
  });

  it('keeps both source build candidates pure, previews off, and no automatic migration owner', () => {
    expect([...blueprint.matchAll(/^\s+buildCommand:\s*(.+)$/gm)].map(m => m[1].trim())).toEqual(BUILDS);
    expect(blueprint).not.toMatch(/^\s+preDeployCommand:/m);
    expect(blueprint).toMatch(/^previews:\s*\n\s+generation: off/m);
    expect([...blueprint.matchAll(/^\s+autoDeployTrigger:\s*(.+)$/gm)].map(m => m[1].trim())).toEqual(['off', 'off']);
  });

  for (const [client, args] of [[true, ['run', 'build']], [false, ['run', 'build:backend']], [false, ['run', 'build:worker']], [true, ['run', 'prepare']], [false, ['run', 'prestart']]]) {
    it(`real npm dispatch: ${args.join(' ')}; client=${client}`, () => {
      const f = buildFixture({ client });
      try {
        const r = f.run(args);
        expect(r.status, r.out).toBe(0);
        expect(r.events.filter(e => e.kind === 'FORBIDDEN'), r.out).toEqual([]);
        if (args[1].startsWith('build')) expect(r.events).toContainEqual({ kind: 'prisma', detail: ['generate'] });
      } finally { f.close(); }
    }, 35_000);
  }

  for (const [i, build] of BUILDS.entries()) {
    it(`executes source ${i === 0 ? 'Web' : 'Worker'} build candidate through protected install and tool boundaries`, () => {
      const f = buildFixture({ client: i === 0, mutate(p) { p.scripts['fixture:candidate'] = build; } });
      try {
        const r = f.run(['run', 'fixture:candidate']);
        expect(r.status, r.out).toBe(0);
        expect(r.events.filter(e => e.kind === 'FORBIDDEN'), r.out).toEqual([]);
        expect(r.events).toContainEqual({ kind: 'prisma', detail: ['generate'] });
        expect(r.events.some(e => e.kind === 'install-fixture')).toBe(true);
      } finally { f.close(); }
    }, 35_000);
  }

  for (const [edge, command] of [
    ['prebuild', 'npx prisma migrate deploy'],
    ['postbuild', 'npx prisma migrate resolve --rolled-back fixture_76'],
    ['prebuild:backend', 'node scripts/migrate.js'],
    ['postinstall', 'psql -c "SELECT 1"'],
    ['build:worker', 'node scripts/prisma-migrate-safe.js'],
    ['build:worker', 'npm install --include=dev && npx prisma generate && node scripts/prisma-migrate-safe.js'],
  ]) {
    it(`positive control: reintroducing ${command} in ${edge} is detected and fails`, () => {
      const f = buildFixture({ mutate(p) { p.scripts[edge] = command; } });
      try {
        const target = edge === 'postinstall' ? 'fixture:install' : edge.includes('backend') ? 'build:backend' : edge === 'build:worker' ? edge : 'build';
        // npm ci is protected, but its lifecycle hooks use the actual npm runner.
        if (edge === 'postinstall') {
          const p = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'));
          p.scripts[target] = 'npm ci --include=dev';
          // Fixture only; no application manifest mutation.
          writeFileSync(join(f.root, 'package.json'), JSON.stringify(p));
        }
        const r = f.run(['run', target]);
        expect(r.status, r.out).not.toBe(0);
        expect(r.events.some(e => e.kind === 'FORBIDDEN'), r.out).toBe(true);
      } finally { f.close(); }
    }, 35_000);
  }

  it('records a swallowed child socket violation even when npm exits successfully', () => {
    const f = buildFixture({ mutate(p) {
      // Isolate the recorder control from the baseline's known migration edge.
      p.scripts.build = 'npm run prisma:generate && npm run build:client';
      p.scripts.prebuild = 'node -e "try { require(\'node:net\').connect(1, \'127.0.0.1\'); } catch {}"';
    } });
    try {
      const r = f.run(['run', 'build']);
      expect(r.status, r.out).toBe(0);
      // Ordinary build tests require this list to be EMPTY, independently of exit.
      expect(r.events.filter(e => e.kind === 'FORBIDDEN')).toEqual([{ kind: 'FORBIDDEN', detail: 'network connect' }]);
    } finally { f.close(); }
  }, 35_000);

  it('H-1: green status in a P3009 diagnostic neither certifies schema nor unfreezes deploy', () => {
    const f = buildFixture({ mutate(p) { p.scripts['fixture:gate'] = 'node scripts/prisma-migrate-safe.js'; } });
    try {
      const r = f.run(['run', 'fixture:gate'], { DIAGNOSTIC_FIXTURE: '1' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('Database schema is up to date!');
      expect(r.out).toMatch(/rolled.back.*pending/is);
      expect(r.out).toContain('_prisma_migrations');
      expect(r.out).toMatch(/native catalogs/i);
      expect(r.out).toContain('NO-DEPLOY FREEZE');
      expect(r.events.filter(e => e.kind === 'prisma').map(e => e.detail)).toEqual([['migrate', 'deploy'], ['migrate', 'status']]);
    } finally { f.close(); }
  }, 35_000);
});

