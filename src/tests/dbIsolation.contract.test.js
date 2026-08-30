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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MAX_WORKERS, databaseIdentity, databaseName, workerName,
  urlForDatabase, resolveIsolationRoot, IsolationSetupError, TEST_DB_ENV,
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
    await a.workspace.upsert({ where: { id: SHARED }, update: {}, create: { id: SHARED, name: 'A' } });
    // Same primary key, other database — must simply succeed.
    await expect(
      b.workspace.upsert({ where: { id: SHARED }, update: {}, create: { id: SHARED, name: 'B' } }),
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

  it('Test 9 · every worker database carries the full migration state', async () => {
    const applied = await a.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    const other = await b.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(applied[0].n).toBeGreaterThan(60);        // 66 migrations ship today
    expect(other[0].n).toBe(applied[0].n);           // the template copy is faithful
  });
});
