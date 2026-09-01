// ============================================================
// B5-CI-01 · CI must make the same verification claim as the repository
// ============================================================
// THE PROPERTY
//
//   A green GitHub result asserts what `npm run test:full` asserts.
//
// It did not. Backend CI ran `npx vitest run`, which bypasses
// scripts/run-tests.js — the repository's verification owner — so REQUIRE_DB
// was never set and DB-backed suites were permitted to skip. Measured on
// 6505872, the same commit, the same 323 files:
//
//     CI  (npx vitest run)   5127 passed | 36 skipped
//     npm run test:full      5163 passed |  0 skipped
//
// Among the 36: all six tests of the worker schema-readiness gate, which is the
// property that a worker refuses to mutate a live ad platform against a stale
// schema. CI had a postgres service and ran `prisma migrate deploy` against it,
// and still proved none of that — which is exactly why the ratchets below assert
// the COMMAND and not the presence of a database.
//
// ── WHY THESE READ EXTRACTED COMMANDS, NOT THE FILE TEXT ────────────────────
// The workflow now explains, in a comment, that it used to say `npx vitest run`.
// A ratchet that grepped the raw YAML would fail on that explanation — the same
// trap security-check.js documents ("a scanner that cannot tell the description
// from the deed reports the explanation as the violation") and the same one
// B5-01X' hit. So `steps()` parses `- name:` / `run:` pairs and every assertion
// below is made against a command a runner would actually execute.
//
// The workflows are the subject; nothing here spawns CI or touches a database.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { resolveRun } from '../../scripts/run-tests.js';
import { REQUIRE_DB_ENV } from './dbProbe.js';
import { TEST_DB_ENV, databaseIdentity } from './dbIsolation.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

const TESTS_WF = '.github/workflows/tests.yml';
const ARCH_WF = '.github/workflows/architecture-check.yml';

const testsYml = read(TESTS_WF);
const archYml = read(ARCH_WF);
const pkg = JSON.parse(read('package.json'));

/** Full-line YAML comments removed, line count preserved for readability. */
const stripComments = (yml) =>
  yml.split(/\r?\n/).map((l) => (l.trim().startsWith('#') ? '' : l)).join('\n');

/**
 * The `- name:` / `run:` pairs a runner would execute. Block scalars (`run: |`)
 * are collected too, so the bundle-budget step is not invisible to this parser.
 */
function steps(yml) {
  const lines = stripComments(yml).split('\n');
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const named = lines[i].match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (named) {
      if (cur?.run != null) out.push(cur);
      cur = { name: named[1], run: null };
      continue;
    }
    if (!cur) continue;
    const ran = lines[i].match(/^(\s*)run:\s*(.*)$/);
    if (!ran) continue;
    if (ran[2].trim() === '|' || ran[2].trim() === '>') {
      const indent = ran[1].length;
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') { body.push(''); continue; }
        if (lines[j].match(/^\s*/)[0].length <= indent) break;
        body.push(lines[j].trim());
      }
      cur.run = body.join('\n').trim();
    } else {
      cur.run = ran[2].trim();
    }
  }
  if (cur?.run != null) out.push(cur);
  return out;
}

/** A job-level `env:` mapping, as literal strings. */
function workflowEnv(yml) {
  const env = {};
  for (const line of stripComments(yml).split('\n')) {
    const m = line.match(/^\s{4,}([A-Z][A-Z0-9_]*):\s*"([^"]*)"\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const testSteps = steps(testsYml);
const archSteps = steps(archYml);

/** The step that runs the backend suite, found by what it DOES. */
const backendStep = testSteps.find((s) => /run-tests\.js|npm (run )?test/.test(s.run) && !/--workspace client/.test(s.run));

// ════════════════════════════════════════════════════════════
describe('B5-CI-01 · T1 — backend CI cannot silently revert to raw Vitest', () => {
  it('the Tests workflow has a backend verification step at all', () => {
    expect(backendStep, `${TESTS_WF} must run the backend suite`).toBeTruthy();
  });

  it('it routes through the repository-owned runner, in FULL mode', () => {
    // Either spelling is equivalent and allowed; what is forbidden is bypassing
    // the owner. `npm run test:full` is preferred because the script, not the
    // workflow, is where the mode contract lives.
    expect(backendStep.run).toMatch(/npm run test:full|run-tests\.js\s+full/);
  });

  it('no step invokes vitest directly', () => {
    // THE regression. `npx vitest run` is a legal command that runs the same
    // files and makes a weaker claim, which is precisely why nobody noticed.
    const direct = [...testSteps, ...archSteps]
      .filter((s) => /\bvitest\b/.test(s.run) && !/run-tests\.js/.test(s.run));
    expect(direct.map((s) => s.name)).toEqual([]);
  });

  it('…and does not quietly resolve to FAST mode', () => {
    expect(backendStep.run).not.toMatch(/run-tests\.js\s+fast|npm run test:fast/);
    // `npm test` is fast mode. It is a legitimate local command and an
    // illegitimate CI verification claim.
    expect(backendStep.run).not.toMatch(/^npm test\b/);
  });

  it('the command it names actually reaches the runner', () => {
    // Chain, not vibes: workflow → package.json → run-tests.js.
    expect(pkg.scripts['test:full']).toMatch(/run-tests\.js\s+full/);
    const runner = read('scripts/run-tests.js');
    expect(runner).toContain('vitest.mjs');
  });
});

// ════════════════════════════════════════════════════════════
describe('B5-CI-01 · T2 — required backend gates cannot vanish from CI', () => {
  // Both are required by the repository's own enforcement: .husky/pre-commit
  // blocks a commit when either exits non-zero, and `check` additionally gates
  // `npm start` via `prestart`. CI representing them is not a new policy.
  const checkStep = archSteps.find((s) => /npm run check(?![:\w-])/.test(s.run));
  const lintStep = archSteps.find((s) => /npm run lint(?![:\w-])/.test(s.run));

  it('`npm run check` is a CI step', () => {
    expect(checkStep, `${ARCH_WF} must run npm run check`).toBeTruthy();
  });

  it('`npm run lint` is a CI step — and the CLIENT lint does not count as it', () => {
    expect(lintStep, `${ARCH_WF} must run npm run lint`).toBeTruthy();
    // `npm run lint:ci --workspace client` is a different gate on different
    // files. Without the negative lookahead above it would satisfy this
    // assertion by substring and the backend would go unlinted while the test
    // stayed green.
    expect(lintStep.run).not.toMatch(/--workspace client/);
    expect(lintStep.run).not.toMatch(/lint:ci/);
  });

  it('they are distinct, individually attributable steps', () => {
    expect(checkStep.name).not.toBe(lintStep.name);
    // §9: a failure must name its gate. An opaque `a && b && c` chain reports
    // one red step for three different reasons.
    for (const s of [checkStep, lintStep]) {
      expect(s.run, `"${s.name}" must stay a single command`).not.toMatch(/&&|\|\||;|\n/);
    }
  });

  it('the existing CI-only protections are still present', () => {
    // Parity must not be bought by dropping something that already worked.
    const runs = archSteps.map((s) => s.run).join('\n');
    for (const gate of [
      /boot-check\.js/, /arch-check\.js/, /security-check\.js/,
      /lint:ci --workspace client/, /build --workspace client/, /gzip/,
    ]) {
      expect(runs, `${ARCH_WF} lost a gate matching ${gate}`).toMatch(gate);
    }
    expect(steps(testsYml).some((s) => /--workspace client/.test(s.run))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
describe('B5-CI-01 · T3 — full DB verification stays fail-closed in CI', () => {
  const env = workflowEnv(testsYml);

  it('the workflow supplies the isolation root the code actually reads', () => {
    // Tied to the constant, not to the string: renaming TEST_DB_ENV in
    // dbIsolation.js without updating the workflow breaks this test rather than
    // silently costing CI its ability to run full verification at all.
    expect(TEST_DB_ENV).toBe('TEST_DATABASE_URL');
    expect(env[TEST_DB_ENV], `${TESTS_WF} must set ${TEST_DB_ENV}`).toBeTruthy();
  });

  it('the isolation root is not the ambient database', () => {
    // Mirrors resolveIsolationRoot()'s own predicate. Full verification DROPS
    // and recreates every database derived from this root; pointing it at
    // DATABASE_URL would make CI destroy the database it was told to test
    // against, and the run would refuse to start.
    expect(databaseIdentity(env[TEST_DB_ENV])).not.toBe(databaseIdentity(env.DATABASE_URL));
  });

  it('a postgres service is NOT what makes the claim — the command is', () => {
    // The distinction this whole slice turns on. Before B5-CI-01 the workflow
    // already had a postgres service AND migrated it, and 36 DB-backed tests
    // still skipped, because nothing set REQUIRE_DB.
    expect(testsYml).toMatch(/^\s*services:/m);                      // necessary
    expect(backendStep.run).toMatch(/test:full|run-tests\.js\s+full/); // sufficient
    expect(resolveRun('full').requireDb).toBe(true);
    expect(resolveRun('full').env[REQUIRE_DB_ENV]).toBe('1');
    // And the weaker mode remains genuinely weaker, so this is a real choice.
    expect(resolveRun('fast').env[REQUIRE_DB_ENV]).toBeUndefined();
  });
});
