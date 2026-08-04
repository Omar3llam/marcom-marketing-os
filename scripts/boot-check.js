#!/usr/bin/env node
// ============================================================
// MARCOM — Boot Check
// ============================================================
// Answers the one question no other gate asks: DOES THE SERVER'S MODULE GRAPH
// LOAD?
//
// WHY THIS EXISTS
//   PRs #312 and #313 were each green. #312 added `export const FATIGUE_FREQ`
//   to verdictEngine.js; #313 added `import { FATIGUE_FREQ }` to the same file,
//   ~30 lines away. Git merged them with no conflict, every test passed on both
//   branches, and master shipped a module that does not parse:
//
//     SyntaxError: Identifier 'FATIGUE_FREQ' has already been declared
//
//   verdictEngine is on the boot path, so production crash-looped. Nothing
//   between "every PR is green" and "the merge result boots" was looking.
//
// TWO PASSES, because they catch different things:
//
//   1. PARSE — node --check every backend .js.
//      Catches syntax errors anywhere in src/, including files no test imports.
//      This alone would have caught the incident above.
//
//   2. LINK — spawn `node src/server.js` with the required env vars blanked.
//      ESM resolves and links the ENTIRE static import graph before executing
//      any module body. config.js (the first import in server.js) exits on
//      missing env. So reaching that exit is proof the whole graph parsed AND
//      every specifier resolved. A bad import path, a missing named export, or
//      a circular-import failure dies BEFORE it, with different stderr.
//
//      This costs no database, no port bind, no timeout, and no cleanup: the
//      process exits on its own, deterministically, in well under a second.
//
// WHAT THIS DOES NOT CATCH
//   Runtime failures after boot. A module that loads fine and throws on first
//   call (the firebase-admin v14 namespaced-default breakage) still gets
//   through. This is a load-time gate, and claiming more would be worse than
//   claiming less.
//
// Usage: node scripts/boot-check.js
// ============================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Blanked, not deleted: server.js runs dotenv before config.js, and dotenv
// fills in any key NOT already present in process.env. A developer's local .env
// would therefore satisfy the check and this gate would silently pass on their
// machine while failing in CI. An explicitly-empty value is "present" to dotenv
// and falsy to config.js's `!process.env[k]`, which is exactly what we want.
const BLANKED_ENV = Object.freeze({
  ANTHROPIC_API_KEY: '',
  DATABASE_URL:      '',
  WEBHOOK_SECRET:    '',
});

// The message config.js writes when it rejects the blanked env. Reaching it is
// the success signal. Kept as a literal so a change to config.js's copy fails
// this check loudly rather than turning it into a no-op that always "passes".
const ENV_GATE_MARKER = 'Missing required environment variables';

// stderr signatures that mean the module graph itself is broken. Listed
// explicitly so the failure output can name WHICH kind, rather than dumping a
// stack and leaving the reader to work it out.
const LOAD_FAILURES = [
  ['SyntaxError',            'a file does not parse (duplicate declaration, stray token, …)'],
  ['ERR_MODULE_NOT_FOUND',   'an import points at a file that does not exist'],
  ['Cannot find module',     'an import points at a file that does not exist'],
  ['does not provide an export named', 'an import names an export the target does not have'],
  ['ERR_REQUIRE_ESM',        'a CommonJS require() of an ES module'],
  ['ReferenceError: Cannot access', 'a circular import used a binding before initialisation'],
];

function fail(msg, detail) {
  process.stderr.write(`\n❌ boot-check: ${msg}\n`);
  if (detail) process.stderr.write(`\n${detail.trim()}\n`);
  process.exit(1);
}

// ── Pass 1: every backend file parses ───────────────────────────────────────
function parseAll() {
  const files = execFileSync(
    'git', ['ls-files', 'src/*.js', 'src/**/*.js'],
    { cwd: ROOT, encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  if (!files.length) fail('no backend files found — is this the repo root?');

  const broken = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) broken.push(`${f}\n${(r.stderr || '').trim()}`);
  }

  if (broken.length) {
    fail(`${broken.length} file(s) do not parse`, broken.join('\n\n'));
  }
  console.log(`✅ parse: ${files.length} backend files`);
}

// ── Pass 2: the server's whole import graph links ───────────────────────────
function linkServer() {
  const r = spawnSync(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...BLANKED_ENV },
  });
  const stderr = r.stderr || '';

  const hit = LOAD_FAILURES.find(([sig]) => stderr.includes(sig));
  if (hit) {
    fail(`the server's module graph does not load — ${hit[1]}`, stderr);
  }

  if (!stderr.includes(ENV_GATE_MARKER)) {
    // Either config.js's message changed (this gate is now blind and must be
    // updated) or the process failed somewhere unexpected. Both need a human.
    fail(
      `server.js exited without reaching the env-var gate (exit ${r.status}).\n` +
      `   Expected stderr to contain: "${ENV_GATE_MARKER}"\n` +
      '   If config.js changed its message, update ENV_GATE_MARKER in this script.',
      stderr || r.stdout || '(no output)',
    );
  }

  console.log('✅ link:  server.js import graph resolves end-to-end');
}

parseAll();
linkServer();
console.log('✅ boot-check passed');
