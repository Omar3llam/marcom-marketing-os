// ============================================================
// B5-01G · the verification command contract
// ============================================================
// B5-Discovery-03 measured three things this suite exists to keep true:
//
//   1. `npm test` ran a 13-case HTTP script against localhost:3000 and ZERO
//      tests from the backend suite. The suite's real command, `npx vitest
//      run`, appeared nowhere except a GitHub Actions workflow.
//   2. A run with no usable database reported `4631 passed | 330 skipped` and
//      EXIT 0 — and a real data-corruption defect (duplicate revenue rows, see
//      nonDailySnapshotWrite.js) survived it untouched.
//   3. 11 of the 27 DB-gated files made the database mandatory only when
//      `process.env.CI` was set. CI has not executed since 2026-08-23, so that
//      condition was never true anywhere.
//
// These are ratchets on BEHAVIOUR, not prose. B5-01B's lesson applies: a test
// that reads a comment describing the old defect catches nothing. Every
// assertion below reads package.json, the runner's own resolver, the file
// census, or a spawned process — never documentation.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dbRequired,
  scrubConnectionSecrets,
  DatabaseVerificationRequiredError,
  DB_VERIFICATION_REQUIRED,
  REQUIRE_DB_ENV,
} from './dbProbe.js';
import { resolveRun, MODES, banner } from '../../scripts/run-tests.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

/** Every backend test file the suite can discover. */
function allTestFiles(dir = join(REPO_ROOT, 'src'), out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') allTestFiles(p, out); }
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/** This file, by its own module URL rather than a path literal that could rot. */
const SELF = fileURLToPath(import.meta.url);

/**
 * A file is DB-gated iff it CALLS the shared probe — not merely mentions it.
 *
 * SELF is excluded, and the exclusion is structural rather than a special case:
 * this is the file that DEFINES the census, so it necessarily quotes every
 * pattern it searches for — `dbAvailable()`, `process.env.CI`,
 * `skipIf(!DB_OK)`. It counted itself twice during development, first as the
 * 28th gated suite and then as a Ratchet C violation. A file that searches for
 * a pattern cannot also be a specimen of it.
 */
const dbGatedFiles = () =>
  allTestFiles()
    .filter((f) => f !== SELF)
    .filter((f) => /\bdbAvailable\s*\(/.test(readFileSync(f, 'utf8')));

const rel = (p) => relative(REPO_ROOT, p).split('\\').join('/');

// ── Ratchet A — npm test points at the backend suite ────────────────────────
describe('B5-01G · Ratchet A — `npm test` is the backend verification entry point', () => {
  it('runs the vitest runner, not the HTTP system script', () => {
    expect(pkg.scripts.test).toContain('run-tests.js');
    // The precise regression: `npm test` used to be `node scripts/test-system.js`,
    // 13 HTTP cases and no backend tests at all.
    expect(pkg.scripts.test).not.toContain('test-system.js');
  });

  it('the HTTP script still exists, under a name that says what it is', () => {
    expect(pkg.scripts['test:http']).toBe('node scripts/test-system.js');
  });

  it('declares both verification modes explicitly', () => {
    expect(pkg.scripts['test:fast']).toContain('run-tests.js fast');
    expect(pkg.scripts['test:full']).toContain('run-tests.js full');
  });

  it('Test 5 · npm test cannot resolve to a command that runs zero vitest tests', () => {
    // Mechanical, not by inspection: whatever `test` runs must be the runner,
    // and the runner must invoke vitest.
    const runner = readFileSync(join(REPO_ROOT, 'scripts/run-tests.js'), 'utf8');
    expect(runner).toContain('vitest.mjs');
    expect(pkg.scripts.test).toMatch(/run-tests\.js (fast|full)/);
  });
});

// ── Ratchet D — full mode has no silent-success path ────────────────────────
describe('B5-01G · Ratchet D — `test:full` cannot quietly become `test:fast`', () => {
  it('full sets REQUIRE_DB=1 and fast does not', () => {
    expect(resolveRun('full').env.REQUIRE_DB).toBe('1');
    expect(resolveRun('full').requireDb).toBe(true);
    expect(resolveRun('fast').env.REQUIRE_DB).toBeUndefined();
    expect(resolveRun('fast').requireDb).toBe(false);
  });

  it('§7.2 · both modes run the SAME suite — the mode is not a file list', () => {
    expect(resolveRun('fast').args).toEqual(resolveRun('full').args);
    expect(resolveRun('fast').args).toEqual(['run']);
    // A passthrough argument reaches vitest unchanged in either mode, so the
    // two commands cannot drift into different test universes.
    expect(resolveRun('full', ['src/x.test.js']).args).toEqual(['run', 'src/x.test.js']);
  });

  it('an unknown mode is refused rather than defaulting to the weaker one', () => {
    expect(() => resolveRun('ful')).toThrow(/unknown mode/);
    expect(() => resolveRun('')).toThrow(/unknown mode/);
    expect(MODES).toEqual(['fast', 'full']);
  });

  it('the banner states what each run does NOT claim', () => {
    expect(banner('fast')).toMatch(/no claim about database semantics/i);
    expect(banner('full')).toMatch(/must execute/i);
  });
});

// ── Ratchets B + C — the census, complete and CI-free ───────────────────────
describe('B5-01G · Ratchets B & C — every DB-gated file participates', () => {
  it('the census matches the current baseline of 29 files', () => {
    // A drift here is not automatically a failure — but it must be NOTICED,
    // because a new DB-gated file added through a different mechanism is
    // exactly how the guarantee erodes.
    //
    // 27 → 28 in B5-01H: budgetAllocator.test.js writes real
    // reinforcementSnapshot rows and had no gate at all, so an ordinary
    // `npm test` wrote them to the developer's own development database. It
    // now takes the same gate as the rest.
    //
    // 28 → 29 in B5-01V: institutionalMemory.projection.integration.test.js.
    // The defect it guards was invisible to a mocked suite BY CONSTRUCTION — a
    // mocked findMany never applies the Prisma `select`, so the memory layer's
    // 31 green unit tests were asserting on a row shape production could not
    // return. Proving a projection needs a real database, so this file is
    // gated like the rest and the census moves with it.
    //
    // 29 → 30 in B5-01X': outcomeEvidenceComparison.integration.test.js. Every
    // number the operator is shown has to trace to rows that actually exist, and
    // a mocked reader would let the suite agree with a query the database could
    // not answer. Its two load-bearing assertions — that observing changes no
    // outcome, pattern or memory, and that DAILY stays out of the operational
    // population — are only meaningful against real tables.
    expect(dbGatedFiles().length).toBe(30);
  });

  it('Ratchet B · every DB-gated file obtains its gate from the shared probe', () => {
    // Matches the module SPECIFIER, so both import shapes in the census count:
    // `import { dbAvailable } from '../../tests/dbProbe.js'` and the deferred
    // `const { dbAvailable } = await import('../../tests/dbProbe.js')` that
    // seven of these files use to control mock ordering.
    const offenders = dbGatedFiles().filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !/['"][./]+tests\/dbProbe\.js['"]/.test(src);
    });
    // A file rolling its own probe would sit outside REQUIRE_DB enforcement.
    expect(offenders.map(rel)).toEqual([]);
  });

  it('Ratchet B · …and every one of them ACTS on the answer', () => {
    // Calling the probe is not the same as obeying it. B5-01H's MCB mutation
    // removed `describe.skipIf(!DB_OK)` while leaving the `await dbAvailable()`
    // call in place, and the census above still counted the file as gated — a
    // suite that asks whether a database exists and then runs anyway would
    // have passed this ratchet.
    const offenders = dbGatedFiles().filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !/skipIf\(\s*!\s*DB_OK\s*\)/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('Ratchet C · no DB-gated file decides the database requirement from process.env.CI', () => {
    const offenders = dbGatedFiles().filter((f) => /process\.env\.CI/.test(readFileSync(f, 'utf8')));
    // MCC bites here: leave one file on the old CI-only behaviour and this
    // fails, whether or not that file was touched during implementation.
    expect(offenders.map(rel)).toEqual([]);
  });

  it('Test 6 · the enforcement point itself is not conditional on CI', () => {
    const probe = readFileSync(join(REPO_ROOT, 'src/tests/dbProbe.js'), 'utf8');
    expect(probe).not.toMatch(/process\.env\.CI\b/);
    expect(probe).toContain(REQUIRE_DB_ENV);
  });
});

// ── The helper's own contract ───────────────────────────────────────────────
describe('B5-01G · dbProbe requirement contract', () => {
  it('dbRequired() is true only for the exact opt-in value', () => {
    const original = process.env[REQUIRE_DB_ENV];
    try {
      delete process.env[REQUIRE_DB_ENV];
      expect(dbRequired()).toBe(false);
      process.env[REQUIRE_DB_ENV] = '0';
      expect(dbRequired()).toBe(false);
      process.env[REQUIRE_DB_ENV] = 'true';   // not the contract
      expect(dbRequired()).toBe(false);
      process.env[REQUIRE_DB_ENV] = '1';
      expect(dbRequired()).toBe(true);
    } finally {
      if (original === undefined) delete process.env[REQUIRE_DB_ENV];
      else process.env[REQUIRE_DB_ENV] = original;
    }
  });

  it('the failure carries a stable code, matched on code and never on message', () => {
    const err = new DatabaseVerificationRequiredError('probe timed out');
    expect(err.code).toBe(DB_VERIFICATION_REQUIRED);
    expect(err.name).toBe('DatabaseVerificationRequiredError');
    expect(err).toBeInstanceOf(Error);
  });

  it('the failure tells the reader what to do instead of just what broke', () => {
    const err = new DatabaseVerificationRequiredError('nope');
    expect(err.message).toContain('test:fast');
    expect(err.message).toContain('probe failure: nope');
  });

  it('connection credentials never travel into the error text', () => {
    const leaky = "Can't reach database server at postgresql://admin:hunter2@db.example:5432/marcom";
    const scrubbed = scrubConnectionSecrets(leaky);
    expect(scrubbed).not.toContain('hunter2');
    expect(scrubbed).not.toContain('admin');
    expect(scrubbed).toContain('<redacted>@');
    // The diagnosable part survives — a scrub that removed the host would
    // make the error useless.
    expect(scrubbed).toContain('db.example:5432');
    expect(new DatabaseVerificationRequiredError(scrubbed).message).not.toContain('hunter2');
  });
});

// ── Tests 1 + 2 — the behaviour, in real subprocesses ───────────────────────
// A malformed DATABASE_URL is the fastest unusable-database condition (~60ms
// probe failure vs ~2.1s for an unreachable host) and, unlike unsetting it,
// actually takes effect: PrismaClient back-fills DATABASE_URL from .env when
// the variable is absent, so "unset" silently means "whatever .env says".
const BROKEN_DB = 'postgresql://u:p@127.0.0.1:1/definitely-not-a-database';
const ONE_DB_SUITE = 'src/services/entity-graph/canonicalFreshness.integration.test.js';

/** Spawn the real runner against ONE DB-gated file, so this cannot recurse. */
function runMode(mode) {
  // Built by deletion, not by assigning undefined: Node stringifies an
  // undefined env value to the literal "undefined", which would make
  // REQUIRE_DB truthy-but-wrong and quietly invert what fast mode means.
  const env = { ...process.env, DATABASE_URL: BROKEN_DB, DIRECT_URL: BROKEN_DB };
  delete env.REQUIRE_DB;
  // Also removed so the outcome does not depend on the developer's shell:
  // with B5-01H, a designated test database is what full mode provisions from,
  // and inheriting a working one would make "full mode refuses" untestable.
  delete env.TEST_DATABASE_URL;
  delete env.LUMI_TEST_DB_ROOT;

  const r = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts/run-tests.js'), mode, ONE_DB_SUITE],
    { cwd: REPO_ROOT, encoding: 'utf8', env },
  );
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('B5-01G · §9 the two modes against an unusable database', () => {
  // Spawned ONCE each, not per assertion. Every spawn is a full vitest startup
  // competing with the parent suite's own worker pool, and the pool crashes
  // under load often enough already (B5-Discovery-03 STOP-3, ~29% of runs) that
  // adding four of them measurably made it worse. Two runs answer everything
  // below; the third test re-reads them rather than re-running them.
  let fast;
  let full;
  beforeAll(() => { fast = runMode('fast'); full = runMode('full'); }, 240_000);

  it('Test 1 · fast mode skips the DB suite and still succeeds', () => {
    expect(fast.status).toBe(0);
    expect(fast.out).toMatch(/skipped/i);
    // And it does not pretend otherwise.
    expect(fast.out).toMatch(/no claim about database semantics/i);
  });

  it('Test 2 · full mode FAILS rather than reporting a skipped suite as green', () => {
    expect(full.status).toBeGreaterThan(0);
    // B5-01H moved the first line of defence EARLIER. Full verification now
    // refuses at provisioning, before a suite can even be collected, because
    // without a designated test database there is nowhere safe to run. The
    // B5-01G refusal (a skipped DB suite under REQUIRE_DB is a failure) is
    // still in place behind it as a second line — see dbProbe.js.
    expect(full.out).toContain('IsolationSetupError');
    expect(full.out).toContain('TEST_DATABASE_URL');
    // Whichever line fires, the run must never degrade to the ambient database.
    expect(full.out).not.toMatch(/falling back|using DATABASE_URL instead/i);
  });

  it('the two modes genuinely differ on the SAME file — mode is the only variable', () => {
    // Guards against a future change that makes both modes fail (or both pass)
    // for an unrelated reason, which would let Test 2 pass vacuously.
    expect(fast.status).toBe(0);
    expect(full.status).not.toBe(0);
    expect(fast.status).not.toBe(full.status);
  });
});
