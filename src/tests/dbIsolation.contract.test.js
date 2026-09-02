// ============================================================
// B5-01H · the isolation contract, proven against real PostgreSQL
// ============================================================
// §18 asks for a harness that answers ONE question for any pair of suites:
//
//     Can one suite's cleanup predicate affect another suite's fixture?
//
// It is deliberately NOT coupled to memoryManager/budgetAllocator. It takes a
// fixture writer and a cleanup predicate and reports whether the fixture
// survived, so a future DB-backed suite can be checked the same way.
//
// ── WHY THIS DOES NOT RACE TWO VITEST FILES ─────────────────────────────────
// The obvious design — file A creates, file B deletes, A asserts — depends on
// vitest happening to place the two files in different workers. If they land in
// the SAME worker they run sequentially, the rendezvous deadlocks, and the
// experiment reports a scheduling accident rather than an isolation property.
// So the harness talks to the worker databases DIRECTLY: it writes as worker N
// and cleans as worker M. That is the property under test — two workers hold
// separate databases — and it is deterministic on every run.
//
// The pre-fix behaviour is not described here, it is EXECUTED: the same
// experiment run with both sides on ONE database must delete the fixture. If
// that positive control ever stops deleting, the negative result below has
// stopped meaning anything.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MAX_WORKERS, databaseIdentity, databaseName, workerName,
  urlForDatabase, resolveIsolationRoot, IsolationSetupError, TEST_DB_ENV,
  sealTemplate, unsealTemplate, isSourceInUseError, withSourceInUseRetry,
  TEMPLATE_COPY_ATTEMPTS, isRemoteVerificationHost, REMOTE_TEST_TIMEOUT_MS,
} from './dbIsolation.js';

const ISOLATED = process.env.REQUIRE_DB === '1' && Boolean(process.env.LUMI_TEST_DB_ROOT);
const ROOT_URL = process.env[TEST_DB_ENV];
const ROOT = process.env.LUMI_TEST_DB_ROOT;

/** A client on a named worker database. */
const clientFor = (poolId) =>
  new PrismaClient({ datasources: { db: { url: urlForDatabase(ROOT_URL, workerName(ROOT, poolId)) } } });

// ── Pure contract — runs everywhere, no database needed ─────────────────────
describe('B5-01H · isolation contract (pure)', () => {
  it('§15 · refuses to run without an explicitly designated test database', () => {
    expect(() => resolveIsolationRoot({})).toThrow(IsolationSetupError);
    expect(() => resolveIsolationRoot({ DATABASE_URL: 'postgresql://u:p@h:5432/dev' }))
      .toThrow(/not set/);
  });

  it('§15 · refuses when the test database IS the ambient development database', () => {
    const same = 'postgresql://u:p@localhost:5432/marcom';
    expect(() => resolveIsolationRoot({ DATABASE_URL: same, [TEST_DB_ENV]: same }))
      .toThrow(/SAME PostgreSQL database/);
    // Identity is host+port+name, so different CREDENTIALS on the same database
    // are still the same database — a check on the raw string would miss this.
    expect(() => resolveIsolationRoot({
      DATABASE_URL: 'postgresql://alice:1@localhost:5432/marcom',
      [TEST_DB_ENV]: 'postgresql://bob:2@localhost:5432/marcom',
    })).toThrow(/SAME PostgreSQL database/);
  });

  it('§15 · accepts a genuinely distinct database', () => {
    expect(resolveIsolationRoot({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/marcom',
      [TEST_DB_ENV]: 'postgresql://u:p@localhost:5432/marcom_verify',
    })).toBe('postgresql://u:p@localhost:5432/marcom_verify');
  });

  it('worker database names are distinct per pool id', () => {
    const names = new Set(Array.from({ length: MAX_WORKERS }, (_, i) => workerName('root', i + 1)));
    expect(names.size).toBe(MAX_WORKERS);
  });

  it('§10 · parallel execution is preserved — this is isolation, not serialisation', async () => {
    // The forbidden shortcut (§14/§30) is making the race invisible by running
    // one worker. Assert the pool is genuinely wide — and assert it against the
    // RESOLVED config object, not the file's text: an earlier version of this
    // grepped the source, which made it fail on the word `poolOptions`
    // appearing in a comment while passing on a config that pinned nothing.
    expect(MAX_WORKERS).toBeGreaterThan(1);
    const { default: cfg } = await import('../../vitest.config.js');
    expect(cfg.test.maxWorkers).toBe(MAX_WORKERS);
    expect(cfg.test.pool).toBe('forks');
    // Vitest 4 removed `test.poolOptions` and IGNORES it rather than erroring,
    // so a config carrying one is pinning nothing while looking correct.
    expect(cfg.test.poolOptions).toBeUndefined();
    expect(cfg.test.fileParallelism).not.toBe(false);
    expect(cfg.test.isolate).not.toBe(false);
  });

  it('§26.8 · the worker binding fails CLOSED, and never falls back to ambient', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tests/workerDb.js'), 'utf8');
    // Three ways it could go wrong, and all three must throw rather than
    // continue: no provisioning, no worker identity, no designated root.
    expect(src).toMatch(/LUMI_TEST_DB_ROOT[\s\S]*?throw new IsolationSetupError/);
    expect(src).toMatch(/VITEST_POOL_ID[\s\S]*?throw new IsolationSetupError/);
    expect(src).toMatch(/TEST_DATABASE_URL[\s\S]*?throw new IsolationSetupError/);
    // The specific forbidden behaviour (§21): silently using the ambient DB.
    expect(src).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
    expect(src).not.toMatch(/\|\|\s*process\.env\.DATABASE_URL/);
  });

  it('§26.8 · provisioning failure stops the run rather than degrading it', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tests/globalSetup.js'), 'utf8');
    expect(src).toMatch(/throw new IsolationSetupError/);
    // No path in globalSetup may swallow a provisioning error and continue.
    expect(src).not.toMatch(/return\s*\(\s*\)\s*=>\s*\{\}\s*;?\s*\}\s*catch/);
  });

  it('the isolation mechanism is actually wired into the runner', () => {
    const cfg = readFileSync(resolve(process.cwd(), 'vitest.config.js'), 'utf8');
    expect(cfg).toMatch(/globalSetup:\s*\[['"]\.\/src\/tests\/globalSetup\.js['"]\]/);
    // Asserts workerDb is WIRED, not that it is the only setup file. B5-01P″′
    // added networkGuard.js ahead of it (it must install before anything can
    // open a socket), and pinning the whole array made an unrelated, correct
    // addition look like a broken isolation contract. Removing workerDb still
    // fails this, which is the property that matters.
    expect(cfg).toMatch(/setupFiles:\s*\[[^\]]*['"]\.\/src\/tests\/workerDb\.js['"]/);
  });
  it('§26.8 · globalSetup seals the template BEFORE it copies from it', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tests/globalSetup.js'), 'utf8');
    // Match the STATEMENTS, not the words. This file’s header comment contains
    // the phrase “CREATE DATABASE … TEMPLATE”, so anchoring on it asserted only
    // that a comment precedes an import — which is true no matter what the
    // provisioner does. The same trap the poolOptions note above describes.
    const sealed = src.indexOf('await sealTemplate(');
    const copies = src.indexOf('CREATE DATABASE "${name}" TEMPLATE');
    expect(sealed).toBeGreaterThanOrEqual(0);
    expect(copies).toBeGreaterThanOrEqual(0);
    expect(sealed).toBeLessThan(copies);
  });

  it('§21 · a copy that stays occupied fails the run — it is not skipped past', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tests/globalSetup.js'), 'utf8');
    // The copy loop must not swallow its error and carry on with fewer
    // databases than workers: a worker without a database would then fall
    // through to workerDb.js, and the run would claim more than it verified.
    expect(src).not.toMatch(/CREATE DATABASE[\s\S]{0,200}?\.catch\(\(\)\s*=>\s*\{?\s*\}?\)/);
    expect(src).toMatch(/withSourceInUseRetry/);
  });

});

// ── B5-01Z · sealing the template against reattachment ─────────────────────
// Measured against Neon on 2026-09-02: `CREATE DATABASE … TEMPLATE` failed 24
// times in 125s with ZERO sessions ever visible in pg_stat_activity, because a
// background-worker launcher re-attaches to any CONNECTABLE database faster
// than a copy can start. That race cannot be won by terminating — the door has
// to be closed, which is exactly why template0 is not connectable and is
// therefore always copyable.
describe('B5-01Z · template sealing (pure)', () => {
  /** Records the statements a seal issues, in order. */
  const recorder = () => {
    const seen = [];
    return { seen, exec: async (sql) => { seen.push(sql); return []; } };
  };

  it('closes the database to new connections BEFORE evicting the occupants', async () => {
    // Order is the whole property. Terminate-then-close leaves a window in
    // which the launcher reconnects, and that window is the measured failure.
    const { seen, exec } = recorder();
    await sealTemplate(exec, 'root_tmpl');
    const closed = seen.findIndex((s) => /ALLOW_CONNECTIONS\s+false/i.test(s));
    const evicted = seen.findIndex((s) => /pg_terminate_backend/i.test(s));
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(evicted).toBeGreaterThanOrEqual(0);
    expect(closed).toBeLessThan(evicted);
  });

  it('evicts only backends on the template, and never the sealing session itself', async () => {
    const { seen, exec } = recorder();
    await sealTemplate(exec, 'root_tmpl');
    const kill = seen.find((s) => /pg_terminate_backend/i.test(s));
    expect(kill).toMatch(/datname\s*=\s*'root_tmpl'/);
    expect(kill).toMatch(/pid\s*<>\s*pg_backend_pid\(\)/);
  });

  it('reopens the template once copying is done', async () => {
    // The seal exists only for the copy window. Leaving it shut would make
    // the template permanently uninspectable, and migrationContract.test.js
    // P1 legitimately connects to it to prove stale state was destroyed.
    const { seen, exec } = recorder();
    await unsealTemplate(exec, 'root_tmpl');
    expect(seen.some((x) => x.includes('ALLOW_CONNECTIONS true'))).toBe(true);
  });

  it('§26.8 · globalSetup reopens the template AFTER the copies, not before', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tests/globalSetup.js'), 'utf8');
    const copies = src.indexOf('CREATE DATABASE "${name}" TEMPLATE');
    const reopened = src.indexOf('await unsealTemplate(');
    expect(reopened).toBeGreaterThanOrEqual(0);
    expect(copies).toBeLessThan(reopened);
  });
  it('does not mark the template IS_TEMPLATE — that would block its own teardown', () => {
    // A datistemplate=true database cannot be dropped, and drop() swallows
    // errors, so setting it would silently leak one database per run.
    const src = readFileSync(resolve(process.cwd(), 'src/tests/dbIsolation.js'), 'utf8');
    expect(src).not.toMatch(/IS_TEMPLATE\s+true/i);
  });

  it('B5-01Z · EVERY template-copy site in the repo seals its source first', () => {
    // The class, not the caught instance. globalSetup was not the only place
    // copying from a template: productionMigrationSafety.test.js has its own
    // provisioner, and it failed against Neon with the identical 55006 after
    // globalSetup was fixed. A ratchet keyed on the STATEMENT finds the next
    // one too, instead of waiting for it to fail on someone's machine.
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
      return e.name.endsWith('.js') ? [full] : [];
    });
    const copiesFromTemplate = (src) => src.split('\n')
      .some((line) => line.includes('CREATE DATABASE') && line.includes('TEMPLATE'));
    const offenders = walk(resolve(process.cwd(), 'src'))
      .map((f) => [f, readFileSync(f, 'utf8')])
      .filter(([, src]) => copiesFromTemplate(src) && !src.includes('sealTemplate'))
      .map(([f]) => f.slice(process.cwd().length + 1));
    expect(offenders, 'these copy from a template without sealing it first').toEqual([]);
  });


  it('B5-01Z · a loopback verification database keeps the 5s per-test budget', () => {
    expect(isRemoteVerificationHost({ REQUIRE_DB: '1', [TEST_DB_ENV]: 'postgresql://u:p@localhost:5432/v' })).toBe(false);
    expect(isRemoteVerificationHost({ REQUIRE_DB: '1', [TEST_DB_ENV]: 'postgresql://u:p@127.0.0.1:5432/v' })).toBe(false);
    expect(isRemoteVerificationHost({})).toBe(false);
    // Fast mode makes no database claim, so it never widens the budget even
    // when a remote URL happens to be exported in the shell.
    expect(isRemoteVerificationHost({ [TEST_DB_ENV]: 'postgresql://u:p@db.neon.tech/v' })).toBe(false);
  });

  it('B5-01Z · a remote verification database widens it, because every query is a round trip', () => {
    expect(isRemoteVerificationHost({ REQUIRE_DB: '1', [TEST_DB_ENV]: 'postgresql://u:p@ep-x.aws.neon.tech/v' })).toBe(true);
  });

  it('B5-01Z · the runner actually uses that budget', async () => {
    const { default: cfg } = await import('../../vitest.config.js');
    expect(cfg.test.testTimeout).toBe(isRemoteVerificationHost() ? REMOTE_TEST_TIMEOUT_MS : 5000);
  });

  it('recognises 55006 as the source-in-use error, and nothing else', () => {
    expect(isSourceInUseError({ code: '55006' })).toBe(true);
    expect(isSourceInUseError({ code: '42501' })).toBe(false);   // permission denied
    expect(isSourceInUseError(new Error('boom'))).toBe(false);
    expect(isSourceInUseError(undefined)).toBe(false);
  });

  it('retries a source-in-use failure, then returns the eventual success', async () => {
    let calls = 0;
    const result = await withSourceInUseRetry(async () => {
      calls += 1;
      if (calls < 3) { const e = new Error('in use'); e.code = '55006'; throw e; }
      return 'created';
    }, { sleep: async () => {} });
    expect(result).toBe('created');
    expect(calls).toBe(3);
  });

  it('§21 · the retry is BOUNDED and ends in a throw — it never gives up quietly', async () => {
    let calls = 0;
    const boom = async () => { calls += 1; const e = new Error('in use'); e.code = '55006'; throw e; };
    await expect(withSourceInUseRetry(boom, { sleep: async () => {} })).rejects.toThrow(/in use/);
    expect(calls).toBe(TEMPLATE_COPY_ATTEMPTS);
  });

  it('never retries an error that is not source-in-use', async () => {
    let calls = 0;
    const denied = async () => { calls += 1; const e = new Error('permission denied'); e.code = '42501'; throw e; };
    await expect(withSourceInUseRetry(denied, { sleep: async () => {} })).rejects.toThrow(/permission denied/);
    expect(calls).toBe(1);
  });
});

// ── The real thing ──────────────────────────────────────────────────────────
describe.skipIf(!ISOLATED)('B5-01H · cross-worker isolation on real PostgreSQL', () => {
  let a; let b;

  beforeAll(() => { a = clientFor(1); b = clientFor(2); });
  afterAll(async () => {
    await a?.$disconnect().catch(() => {});
    await b?.$disconnect().catch(() => {});
  });

  /**
   * §18 · the reusable harness.
   * Writes a fixture through `write`, runs `cleanup` on `cleaner`, reports
   * whether the fixture survived on `owner`.
   */
  async function pollutionExperiment({ owner, cleaner, write, exists, cleanup }) {
    const id = await write(owner);
    const before = await exists(owner, id);
    await cleanup(cleaner);
    const after = await exists(owner, id);
    return { id, before, after };
  }

  // The EXACT pair Discovery 03 proved collides.
  const provider = () => `test-provider-${randomUUID().slice(0, 8)}`;
  const writeSnapshot = async (client, name) => {
    const ws = await client.workspace.create({ data: { id: randomUUID(), name: `h-${randomUUID().slice(0, 6)}` } });
    await client.reinforcementSnapshot.create({
      data: {
        provider: name, capability: 'GENERATE_HOOKS', score: 80, confidence: 0.9,
        sampleSize: 50, windowStart: new Date('2026-01-01'), windowEnd: new Date('2026-02-01'),
        workspaceId: ws.id,
      },
    });
    return name;
  };
  /** budgetAllocator.test.js:17-21, verbatim. */
  const broadCleanup = (client) =>
    client.reinforcementSnapshot.deleteMany({ where: { provider: { startsWith: 'test-' } } });
  const snapshotExists = async (client, name) =>
    (await client.reinforcementSnapshot.count({ where: { provider: name } })) > 0;

  it('Test 11 · POSITIVE CONTROL — on ONE database the cleanup DOES delete the other fixture', async () => {
    // Without this, "the fixture survived" could mean the predicate never
    // matched anything. This is the pre-fix defect, executed.
    const name = provider();
    const r = await pollutionExperiment({
      owner: a, cleaner: a, // same database == the old world
      write: (c) => writeSnapshot(c, name),
      exists: snapshotExists,
      cleanup: broadCleanup,
    });
    expect(r.before).toBe(true);
    expect(r.after).toBe(false);   // deleted, exactly as Discovery 03 proved
  });

  it('Tests 1+2 · worker B cannot see or delete worker A fixture', async () => {
    const name = provider();
    const r = await pollutionExperiment({
      owner: a, cleaner: b,
      write: (c) => writeSnapshot(c, name),
      exists: snapshotExists,
      cleanup: broadCleanup,
    });
    expect(r.before).toBe(true);
    expect(r.after).toBe(true);                                   // survives
    expect(await snapshotExists(b, name)).toBe(false);            // B never saw it
  });

  it('Test 3 · worker B cannot update worker A fixture', async () => {
    const name = provider();
    await writeSnapshot(a, name);
    await b.reinforcementSnapshot.updateMany({ where: { provider: { startsWith: 'test-' } }, data: { score: 1 } });
    const row = await a.reinforcementSnapshot.findFirst({ where: { provider: name } });
    expect(row.score).toBe(80);
  });

  it('Test 4 · worker B cannot collide with worker A hard-coded identity', async () => {
    // The identity both memoryManager and scoringEngine upsert, which produced
    // "Unique constraint failed on (id)" during B5-01G verification.
    const SHARED = '00000000-0000-0000-0000-000000000001';
    // `update` SETS THE NAME rather than being a no-op (B5-01T′).
    //
    // It used to be `update: {}`, which quietly made this test assume it was the
    // FIRST writer of this id on worker databases 1 and 2. It is not: this id is
    // hard-coded in eight other suites, and memoryManager.test.js creates it with
    // `name: 'Test Workspace 1'`. Whichever ran first won, so when scheduling put
    // that suite on worker 1 ahead of this one, `expect(...name).toBe('A')` read
    // 'Test Workspace 1' and the run failed — about once in three, with nothing
    // in the message pointing at the real cause.
    //
    // Forcing the name removes the assumption without weakening the test: the
    // claim is that ONE primary key can hold DIFFERENT rows in two databases, and
    // that claim is now asserted from any starting state rather than only from an
    // empty one. Surfaced by this slice adding a file, not caused by it.
    await a.workspace.upsert({ where: { id: SHARED }, update: { name: 'A' }, create: { id: SHARED, name: 'A' } });
    // Same primary key, other database — must simply succeed.
    await expect(
      b.workspace.upsert({ where: { id: SHARED }, update: { name: 'B' }, create: { id: SHARED, name: 'B' } }),
    ).resolves.toBeTruthy();
    expect((await a.workspace.findUnique({ where: { id: SHARED } })).name).toBe('A');
    expect((await b.workspace.findUnique({ where: { id: SHARED } })).name).toBe('B');
  });

  it('Test 5 · worker B cannot violate worker A foreign-key assumptions', async () => {
    // The observed failure was an FK violation caused by another suite deleting
    // the workspace row a fixture depended on.
    const ws = await a.workspace.create({ data: { id: randomUUID(), name: 'fk-owner' } });
    await b.workspace.deleteMany({ where: { name: 'fk-owner' } });
    await expect(
      a.reinforcementSnapshot.create({
        data: {
          provider: provider(), capability: 'GENERATE_HOOKS', score: 70, confidence: 0.8,
          sampleSize: 10, windowStart: new Date('2026-01-01'), windowEnd: new Date('2026-02-01'),
          workspaceId: ws.id,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('Tests 6+7 · a named worker client really is on that worker database', async () => {
    const [{ current_database: db }] = await a.$queryRaw`SELECT current_database()`;
    expect(db).toBe(workerName(ROOT, 1));
    expect(db).not.toBe(databaseName(process.env.TEST_DATABASE_URL));
  });

  it('Tests 6+7 · THE BINDING — the client production code uses is on this worker database', async () => {
    // The load-bearing assertion, and the one the first draft of this file was
    // missing. Everything above proves that separate databases EXIST; only this
    // proves that a vitest worker actually USES one. src/lib/prisma.js is the
    // singleton every route, service and worker imports, and it reads
    // DATABASE_URL at module-import time — so if workerDb.js failed to rewrite
    // the environment before that import, this is where it shows.
    const { prisma } = await import('../lib/prisma.js');
    const [{ current_database: db }] = await prisma.$queryRaw`SELECT current_database()`;

    expect(db).toBe(process.env.LUMI_TEST_DB_NAME);
    expect(db).toMatch(new RegExp(`^${ROOT}_w\\d+$`));
    // §7 · and emphatically NOT the developer's ambient database, nor the
    // designated root the worker databases were derived from.
    expect(db).not.toBe(databaseName(process.env.TEST_DATABASE_URL));
    expect(databaseIdentity(process.env.DATABASE_URL)).toContain(db);
  });

  it('B5-01Z · the template is left inspectable, and the copies are usable', async () => {
    // The seal is transient by design: shut for the copy window, reopened
    // immediately after. What must be true by the time suites run is that every
    // database here is connectable — the template because migrationContract P1
    // inspects it, the workers because they are what the suites run against.
    const rows = await a.$queryRaw`
      SELECT datname, datallowconn FROM pg_database
       WHERE datname IN (${`${ROOT}_tmpl`}, ${workerName(ROOT, 1)}, ${workerName(ROOT, 2)})
       ORDER BY datname`;
    const byName = Object.fromEntries(rows.map((r) => [r.datname, r.datallowconn]));
    expect(byName[`${ROOT}_tmpl`]).toBe(true);
    expect(byName[workerName(ROOT, 1)]).toBe(true);
    expect(byName[workerName(ROOT, 2)]).toBe(true);
  });

  it('B5-01Z · the template is not marked datistemplate, so teardown can drop it', async () => {
    const [row] = await a.$queryRaw`
      SELECT datistemplate FROM pg_database WHERE datname = ${`${ROOT}_tmpl`}`;
    expect(row.datistemplate).toBe(false);
  });

  it('Test 9 · every worker database carries the full migration state', async () => {
    const applied = await a.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    const other = await b.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(applied[0].n).toBeGreaterThan(60);        // 66 migrations ship today
    expect(other[0].n).toBe(applied[0].n);           // the template copy is faithful
  });
});
