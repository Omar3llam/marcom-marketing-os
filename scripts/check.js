#!/usr/bin/env node
// ============================================================
// MARCOM / Lumi — Backend sanity check
// ------------------------------------------------------------
// 1. node --check every .js file in src/
// 2. Grep for @/ alias imports (Node.js cannot resolve these)
//
// Exits non-zero if either check fails.
// Called by `npm run check` (and `npm run prestart`).
// ============================================================
import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

let ok = true;

// ── 1. Syntax check ─────────────────────────────────────────
function walkJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJs(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

const files = walkJs('src');
for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (err) {
    console.error(`❌ BROKEN: ${f}`);
    console.error(err.stderr?.toString()?.trim());
    ok = false;
  }
}

// ── 2. @/ alias guard ────────────────────────────────────────
let aliasOutput = '';
try {
  aliasOutput = execSync(
    'grep -rn "from \'@/" src/ --include="*.js"',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
} catch {
  // grep exits 1 on zero matches — that's the GOOD outcome
  aliasOutput = '';
}

if (aliasOutput) {
  console.error('\n❌ @/ path aliases found in backend (Node.js cannot resolve these at runtime):');
  console.error(aliasOutput);
  console.error('\n  Fix: replace @/X with the correct relative path (e.g. ../lib/X.js)');
  ok = false;
}

// ── Summary ──────────────────────────────────────────────────
if (ok) {
  console.log(`✅ All JS syntax valid (${files.length} files) — zero @/ aliases in backend`);
} else {
  process.exit(1);
}
