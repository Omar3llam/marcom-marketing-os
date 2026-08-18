// ============================================================
// CI coverage honesty — the backend test surface is discovered, not listed
// ------------------------------------------------------------
// R12-1. Until this suite existed, `.github/workflows/tests.yml` ran
//
//     npx vitest run src/services src/routes src/utils packages/runtime-contracts
//
// and positional paths OVERRIDE the `include` globs in vitest.config.js. That
// list was written when those four directories were the backend; the
// repository then grew src/middleware, src/workers, src/lib, src/models,
// src/agents, src/config, src/modes and src/tests, and 28 suites appeared in
// them that CI never ran. Seven were R11 security controls — the identity
// boundary, fail-closed authorization, workspace requirement, rate-limit
// principal, dev-override inertness, worker re-authorization. Every one of
// them was mutation-verified locally and enforced nowhere.
//
// A control that never runs is not a control, so this suite guards the
// mechanism rather than any one directory. It fails if:
//
//   • a path list reappears in the workflow (discovery narrows back to an
//     allowlist that the next new directory will silently fall outside of),
//   • vitest.config.js starts excluding backend source, or
//   • a named R11 control suite stops being discoverable.
//
// It deliberately asserts NO file counts. A count would have to be updated on
// every added test, and a number people routinely bump is not a guard.
//
// WHY THIS LIVES IN src/utils AND NOT src/tests: a guard must survive the
// regression it guards against. Placed in src/tests it was discoverable only
// under the fixed discovery — narrowing `include` back to the historical
// src/services + src/routes + src/utils made this file itself undiscoverable,
// so it stopped RUNNING instead of failing and the run stayed green. Verified
// by mutation, not reasoned about. src/utils was inside the old allowlist, so
// any narrowing toward that allowlist still executes this suite and still
// fails. The guard has to be reachable from the broken configuration.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve, sep } from 'path';
import picomatch from 'picomatch';

const ROOT = resolve(__dirname, '..', '..');

const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
const configSrc = readFileSync(join(ROOT, 'vitest.config.js'), 'utf8');

/** The one backend *.test.js that is not a vitest suite. */
const NON_SUITE = ['src/tests/dialect.test.js'];

/** The `run:` line that invokes vitest for the backend job. */
function backendTestCommand() {
  const line = workflow
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('run:') && l.includes('vitest run'));
  return line ? line.replace(/^run:\s*/, '') : null;
}

/** Parse an array literal (include/exclude) out of vitest.config.js. */
function configArray(name) {
  const m = configSrc.match(new RegExp(`${name}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/** Every *.test.js on disk under the backend roots, as posix-ish repo paths. */
function backendTestFiles() {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const next = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(next, rel);
      else if (e.name.endsWith('.test.js')) out.push(next);
    }
  };
  walk('src');
  walk('packages');
  return out;
}

describe('the workflow does not re-narrow discovery (NC1 / NC5)', () => {
  it('invokes vitest with no positional paths', () => {
    const cmd = backendTestCommand();
    expect(cmd).toBeTruthy();

    // Anything after `vitest run` that is not a flag is a path filter, and a
    // path filter is the allowlist coming back.
    const args = cmd.split(/\s+/);
    const after = args.slice(args.indexOf('run') + 1);
    const positional = after.filter((a) => a && !a.startsWith('-'));

    expect(positional).toEqual([]);
  });

  it('does not pass --exclude on the command line', () => {
    // An exclusion that lives in the CI command instead of the config is
    // invisible to everyone running tests locally.
    expect(backendTestCommand()).not.toMatch(/--exclude/);
  });

  it('no longer carries the stale resilience.integration.test.js justification', () => {
    // That suite passes. An exclusion explained by a failure that no longer
    // exists is how an allowlist survives review.
    expect(workflow).not.toMatch(/pre-existing failures/i);
  });
});

describe('vitest.config.js discovers the whole backend (NC2 / NC3)', () => {
  it('includes every backend test file by glob, not by enumeration', () => {
    const include = configArray('include');
    expect(include).toContain('src/**/*.test.js');
    expect(include).toContain('packages/**/*.test.js');
  });

  it('excludes no backend source path except the documented standalone script', () => {
    const exclude = configArray('exclude') ?? [];
    const backendExclusions = exclude.filter((p) => /^(src|packages)\//.test(p));

    // Excluding src/middleware or src/workers would drop R11's authorization
    // and execution controls while leaving CI green.
    expect(backendExclusions).toEqual(NON_SUITE);
  });

  it('every backend test file on disk is discoverable', () => {
    const include = configArray('include') ?? [];
    const exclude = configArray('exclude') ?? [];
    const isIncluded = picomatch(include);
    const isExcluded = picomatch(exclude);

    const missed = backendTestFiles()
      .filter((f) => !NON_SUITE.includes(f))
      .filter((f) => !isIncluded(f) || isExcluded(f));

    expect(missed).toEqual([]);
  });
});

describe('the R11 control suites are covered', () => {
  // Named explicitly because these are the ones whose absence from CI was the
  // whole finding. If one is renamed, this fails and the rename has to say so.
  const R11_CONTROLS = [
    'src/middleware/firebaseAuth.adminGrant.test.js', // I56/I57/I58/I71/I73
    'src/middleware/requireCollabRole.test.js',       // I61 fail-closed
    'src/middleware/requireWorkspace.test.js',        // I60 → 409
    'src/middleware/rateLimitPrincipal.test.js',      // E1 principal
    'src/middleware/rateLimitStore.test.js',          // E1 store
    'src/lib/devOverrides.test.js',                   // I62 inert in production
    'src/workers/executionWorker.reauth.test.js',     // I67 re-authorization
  ];

  const include = configArray('include') ?? [];
  const exclude = configArray('exclude') ?? [];
  const isIncluded = picomatch(include);
  const isExcluded = picomatch(exclude);
  const onDisk = new Set(backendTestFiles());

  it.each(R11_CONTROLS)('%s exists and is discoverable', (file) => {
    expect(onDisk.has(file)).toBe(true);
    expect(isIncluded(file)).toBe(true);
    expect(isExcluded(file)).toBe(false);
  });
});

describe('the standalone script stays out of vitest (NC6)', () => {
  it('dialect.test.js is excluded, and excluded for a stated reason', () => {
    const exclude = configArray('exclude') ?? [];
    expect(exclude).toContain('src/tests/dialect.test.js');
    // The exclusion has to explain itself, or the next reader cannot tell it
    // from the allowlist this suite exists to prevent.
    expect(configSrc).toMatch(/dialect\.test\.js.*standalone/s);
  });

  it('is a node script, not a vitest suite — it imports no vitest API', () => {
    const src = readFileSync(join(ROOT, 'src', 'tests', 'dialect.test.js'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]vitest['"]/);
  });

  it('sanity: the repo path separator did not break the walker', () => {
    expect(backendTestFiles().length).toBeGreaterThan(0);
    expect(sep).toBeTruthy();
  });
});
