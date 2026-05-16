#!/usr/bin/env node
// ============================================================
// MARCOM Architecture Audit Script
// ============================================================
// Runs 6 architecture checks based on MARCOM-ARCHITECTURE.md.
// Called by: npm run arch-check
// Called by: .github/workflows/architecture-check.yml
//
// Exit code 0 = all checks pass
// Exit code 1 = one or more checks fail
// ============================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOT      = process.cwd();
const CLIENT    = join(ROOT, 'client/src');
const BACKEND   = join(ROOT, 'src');

let failures = 0;
let warnings = 0;

function pass(msg)  { console.log(`  ✅ ${msg}`); }
function fail(msg)  { console.log(`  ❌ ${msg}`); failures++; }
function warn(msg)  { console.log(`  🟡 ${msg}`); warnings++; }
function section(title) { console.log(`\n── ${title} ──────────────────────`); }

// ── Helper: get all files recursively ─────────────────────────
function getAllFiles(dir, ext = ['.js', '.jsx']) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...getAllFiles(full, ext));
      else if (ext.includes(extname(entry.name))) files.push(full);
    }
  } catch {}
  return files;
}

// ── Helper: count lines in a file ─────────────────────────────
function lineCount(filepath) {
  try {
    return readFileSync(filepath, 'utf8').split('\n').length;
  } catch { return 0; }
}

// ── Helper: read file content ──────────────────────────────────
function readFile(filepath) {
  try { return readFileSync(filepath, 'utf8'); } catch { return ''; }
}

// ══════════════════════════════════════════════════════════════
// CHECK 1 — File size limits
// ══════════════════════════════════════════════════════════════
section('CHECK 1: File size limits');

const SIZE_LIMITS = [
  { dir: join(CLIENT, 'pages'),   ext: '.jsx', max: 300,  label: 'Page component'    },
  { dir: join(CLIENT, 'hooks'),   ext: '.js',  max: 200,  label: 'Hook'              },
  { dir: join(CLIENT, 'components', 'ui'),  ext: '.jsx', max: 150, label: 'UI primitive' },
  { dir: join(CLIENT, 'context'), ext: '.jsx', max: 100,  label: 'Context'           },
  { dir: join(BACKEND, 'routes'), ext: '.js',  max: 400,  label: 'Route handler'     },
];

let sizePass = true;
for (const { dir, ext, max, label } of SIZE_LIMITS) {
  const files = getAllFiles(dir, [ext]);
  for (const file of files) {
    const lines = lineCount(file);
    const name  = file.replace(ROOT + '/', '');
    if (lines > max * 1.2) {         // 20% tolerance before FAIL
      fail(`${label} too large: ${name} = ${lines} lines (max ${max})`);
      sizePass = false;
    } else if (lines > max) {
      warn(`${label} approaching limit: ${name} = ${lines}/${max} lines`);
    }
  }
}
if (sizePass) pass('All files within size limits');

// ══════════════════════════════════════════════════════════════
// CHECK 2 — Forbidden imports
// ══════════════════════════════════════════════════════════════
section('CHECK 2: Forbidden imports');

const FORBIDDEN_IMPORTS = [
  {
    pattern: /from ['"]\.\.\/services\/orchestrator/,
    message: 'Import of DEPRECATED services/orchestrator.js. Use agents/orchestrator.js',
  },
  {
    pattern: /from ['"]\.\.\/middleware\/clerkAuth/,
    message: 'Import of DEAD clerkAuth.js. Firebase replaced Clerk.',
  },
  {
    pattern: /from ['"]\.\.\/models\/userContext/,
    message: 'Import of DEAD userContext.js. Use campaigns/me/context route.',
  },
  {
    pattern: /from ['"]\.\.\/utils\/airtable/,
    message: 'Import of DEAD airtable.js. Replaced by PostgreSQL.',
  },
];

const backendFiles = getAllFiles(BACKEND, ['.js']);
let importPass = true;

for (const file of backendFiles) {
  const content = readFile(file);
  const name    = file.replace(ROOT + '/', '');
  for (const { pattern, message } of FORBIDDEN_IMPORTS) {
    if (pattern.test(content)) {
      fail(`Forbidden import in ${name}: ${message}`);
      importPass = false;
    }
  }
}

// Frontend: no direct axios.post/get bypassing api client
const frontendFiles = getAllFiles(CLIENT, ['.js', '.jsx']);
for (const file of frontendFiles) {
  const content  = readFile(file);
  const name     = file.replace(ROOT + '/', '');
  // Allow axios.isCancel — that's legitimate
  const directAxios = content.match(/\baxios\.(get|post|put|delete|patch)\s*\(/g);
  if (directAxios) {
    fail(`Direct axios call in ${name}: ${directAxios.join(', ')} — use api client`);
    importPass = false;
  }
}

if (importPass) pass('No forbidden imports detected');

// ══════════════════════════════════════════════════════════════
// CHECK 3 — Raw hex in JSX files
// ══════════════════════════════════════════════════════════════
section('CHECK 3: Raw hex in JSX (design token discipline)');

let hexPass = true;
for (const file of frontendFiles.filter(f => f.endsWith('.jsx'))) {
  const lines   = readFile(file).split('\n');
  const name    = file.replace(ROOT + '/', '');
  lines.forEach((line, i) => {
    // Skip comments and non-className lines
    if (line.trim().startsWith('//') || !line.includes('className')) return;
    const match = line.match(/#[0-9a-fA-F]{3,6}\b/);
    if (match) {
      fail(`Raw hex ${match[0]} in ${name}:${i + 1} — use design token`);
      hexPass = false;
    }
  });
}
if (hexPass) pass('No raw hex values in JSX className props');

// ══════════════════════════════════════════════════════════════
// CHECK 4 — useEffect without cleanup (memory leak detection)
// ══════════════════════════════════════════════════════════════
section('CHECK 4: useEffect cleanup discipline');

let effectPass = true;
for (const file of frontendFiles) {
  const content = readFile(file);
  const name    = file.replace(ROOT + '/', '');

  // Count useEffect with async operations (api.get/post) vs cleanup returns
  const effectsWithFetch = (content.match(/useEffect\([^)]*\(\) =>/g) || []).length;
  if (effectsWithFetch === 0) continue;

  // Simple heuristic: if file has api.get/post in useEffect and no return/cleanup
  const hasFetch   = /useEffect.*?api\.(get|post)/s.test(content);
  const hasCleanup = /return\s*\(\)\s*=>\s*\{/.test(content) ||
                     /return\s*\(\)\s*=>/.test(content);

  if (hasFetch && !hasCleanup) {
    warn(`${name} has useEffect with API call but no visible cleanup`);
    // warn only — not all patterns are catchable statically
  }
}
if (effectPass) pass('useEffect cleanup check passed (static analysis — verify in PR)');

// ══════════════════════════════════════════════════════════════
// CHECK 5 — Backend: Prisma calls in loops (N+1 detection)
// ══════════════════════════════════════════════════════════════
section('CHECK 5: N+1 Prisma query detection');

let prismaPass = true;
for (const file of backendFiles) {
  const content = readFile(file);
  const name    = file.replace(ROOT + '/', '');

  // Heuristic: for/forEach/map containing await prisma.
  const loopPrisma = /for\s*\(.*\).*\{[\s\S]{0,300}await\s+prisma\./m.test(content) ||
                     /\.forEach.*\{[\s\S]{0,200}await\s+prisma\./m.test(content);

  if (loopPrisma) {
    fail(`Possible N+1 Prisma query in ${name} — use createMany/updateMany instead`);
    prismaPass = false;
  }
}
if (prismaPass) pass('No obvious N+1 Prisma patterns detected');

// ══════════════════════════════════════════════════════════════
// CHECK 6 — Component registry integrity
// ══════════════════════════════════════════════════════════════
section('CHECK 6: Component registry — detect similar names');

const uiComponents = getAllFiles(join(CLIENT, 'components'), ['.jsx'])
  .map(f => f.split('/').pop().replace('.jsx', '').toLowerCase());

const SIMILAR_PATTERNS = [
  /^(inline|progress|metric|confidence)(bar|line|fill|chart)$/i,
  /^(decision|verdict|signal)(pill|badge|tag|chip)$/i,
  /^(lumi|ai|intel)(loader|spinner|thinking|pulse)$/i,
];

let registryPass = true;
for (const pattern of SIMILAR_PATTERNS) {
  const matches = uiComponents.filter(name => pattern.test(name));
  if (matches.length > 2) {
    warn(`Possible duplicate components: ${matches.join(', ')} — check if consolidation needed`);
    registryPass = false;
  }
}
if (registryPass) pass('No suspicious component name clusters detected');

// ══════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log(`Architecture Check Results:`);
console.log(`  Checks run:  6`);
console.log(`  ✅ Failures: ${failures}`);
console.log(`  🟡 Warnings: ${warnings}`);
console.log('══════════════════════════════════════════════\n');

if (failures > 0) {
  console.log('❌ Architecture check FAILED. Fix violations before merging.');
  process.exit(1);
} else {
  console.log('✅ Architecture check PASSED.');
  process.exit(0);
}
