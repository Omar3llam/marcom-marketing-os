// ============================================================
// run-tests — the backend verification entry point (B5-01G)
// ============================================================
// NO SHEBANG, deliberately. This module is IMPORTED by
// src/tests/verificationContract.test.js so the mode contract can be asserted
// without spawning a suite, and it is always invoked as `node scripts/run-tests.js`
// — never executed directly — so a shebang buys nothing.
//
// It costs something, though. B5-01G shipped one, and git's autocrlf rewrote
// the file to CRLF on the next checkout: `#!/usr/bin/env node\r\n` defeats the
// transform's shebang strip, and the import failed with a bare
// "SyntaxError: Invalid or unexpected token" naming the importing TEST rather
// than this file. It passed in B5-01G only because the file was still LF on
// disk at the time; a fresh clone would have failed. Do not add it back.
// ============================================================
// ONE suite, TWO claims:
//
//     fast   REQUIRE_DB unset   the backend suite; DB-backed suites may skip.
//                               Makes NO claim about database semantics.
//     full   REQUIRE_DB=1       the same backend suite; DB-backed suites MUST
//                               execute. An unusable database is a FAILURE.
//
// The mode selects an environment variable and nothing else. It deliberately
// does not select a different file list: B5-Discovery-03 found the repository's
// verification ambiguity came from two commands that looked equivalent and were
// not, and a hand-maintained "full" allowlist would rebuild exactly that in a
// new costume. `include` in vitest.config.js stays the single definition of
// what the backend suite IS. (CI once carried such an allowlist; it had grown
// stale enough to exclude whole directories — see .github/workflows/tests.yml.)
//
// Why a script rather than `REQUIRE_DB=1 npx vitest run`: that syntax is a
// POSIX shell feature. This repository is developed on Windows, where cmd.exe
// and PowerShell both reject it, so the inline form would work for some
// developers and silently not for others. Spawning vitest's own entry point by
// absolute path also avoids the .cmd shim. No new dependency: adding cross-env
// to make one line portable is a worse trade than twenty lines that are.
// ============================================================
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const VITEST_ENTRY = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

export const MODES = Object.freeze(['fast', 'full']);

/**
 * PURE: what a mode actually means. Exported so the contract can be asserted
 * without spawning a suite — a test that only ran the command could not tell
 * "full sets REQUIRE_DB" from "full happened to fail".
 *
 * @param {string} mode — 'fast' | 'full'
 * @param {string[]} passthrough — extra argv handed to vitest unchanged
 */
export function resolveRun(mode, passthrough = []) {
  if (!MODES.includes(mode)) {
    throw new Error(`run-tests: unknown mode "${mode}" — expected one of ${MODES.join(', ')}`);
  }
  const requireDb = mode === 'full';
  return {
    mode,
    requireDb,
    // `full` is `fast` plus a requirement. There is no branch in which a full
    // run quietly becomes a fast one — that is the whole point of the mode.
    env: requireDb ? { REQUIRE_DB: '1' } : { REQUIRE_DB: undefined },
    args: ['run', ...passthrough],
  };
}

/** The one-line statement of what this run does and does not claim. */
export function banner(mode) {
  return mode === 'full'
    ? '▶ FULL verification — REQUIRE_DB=1. DB-backed suites must execute; an unusable database fails the run.'
    : '▶ FAST verification — DB-backed suites may skip. This run makes no claim about database semantics.';
}

function main() {
  const [, , mode = 'fast', ...passthrough] = process.argv;
  const plan = resolveRun(mode, passthrough);

  console.log(banner(plan.mode));

  const env = { ...process.env };
  for (const [k, v] of Object.entries(plan.env)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  const child = spawn(process.execPath, [VITEST_ENTRY, ...plan.args], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    // A killed runner is not a passing one. Never collapse a signal to 0.
    process.exit(signal ? 1 : (code ?? 1));
  });
  child.on('error', (err) => {
    console.error(`run-tests: could not start vitest — ${err.message}`);
    process.exit(1);
  });
}

// Only run when invoked directly, so the pure exports above stay importable.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
