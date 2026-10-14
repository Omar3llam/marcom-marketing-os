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
import { verificationScope } from './verificationScope.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import * as pathForMigrations from 'path';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import {
  scanMigrations, verifyAgainstBaseline, summarise,
} from './migrationCompatibility.js';

// The classifier takes its fs/path as arguments so it stays pure and testable.
const fsForMigrations = { readdirSync, readFileSync, existsSync };

const ROOT      = process.cwd();
const { includeFrontend } = verificationScope(ROOT);
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
for (const { dir, ext, max, label } of SIZE_LIMITS.filter(rule => includeFrontend || !rule.dir.startsWith(CLIENT))) {
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
const frontendFiles = includeFrontend ? getAllFiles(CLIENT, ['.js', '.jsx']) : [];
if (!includeFrontend && importPass) pass('No forbidden backend imports detected');
if (includeFrontend) {
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

section('CHECK 2B: Frontend API boundary');

const API_BOUNDARY_DIRS = [
  join(CLIENT, 'app'),
  join(CLIENT, 'features'),
  join(CLIENT, 'design-system'),
  join(CLIENT, 'components', 'layout'),
];
const apiBoundaryFiles = API_BOUNDARY_DIRS.flatMap((dir) => getAllFiles(dir, ['.js', '.jsx', '.ts', '.tsx']));
const forbiddenApiBoundaryImport = /from\s+['"][^'"]*(?:@\/lib\/api|\/lib\/api|\.\.?\/.*lib\/api)[^'"]*['"]/;
const directFetchCall = /\bfetch\s*\(/;
let apiBoundaryPass = true;

for (const file of apiBoundaryFiles) {
  const content = readFile(file);
  const name = file.replace(ROOT + '/', '');

  if (forbiddenApiBoundaryImport.test(content)) {
    fail(`Direct shared API client import in ${name} — use feature services and @/api/client`);
    apiBoundaryPass = false;
  }

  if (directFetchCall.test(content)) {
    fail(`Raw fetch call in ${name} — use feature services and @/api/client`);
    apiBoundaryPass = false;
  }
}

if (apiBoundaryPass) pass('New frontend layers respect the API boundary');

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
} else console.log('Frontend import/API/token/effect rules: outside backend scope; run full legacy verification separately.');

// ══════════════════════════════════════════════════════════════
// CHECK 5 — Backend: Prisma calls in loops (N+1 detection)
// ══════════════════════════════════════════════════════════════
section('CHECK 5: N+1 Prisma query detection');

let prismaPass = true;
for (const file of backendFiles) {
  const content = readFile(file);
  const name    = file.replace(ROOT + '/', '');

  // Skip test files (test data creation loops are intentional)
  if (name.includes('.test.js') || name.includes('.spec.js')) continue;

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
if (includeFrontend) {
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
} else console.log('Frontend component registry: outside backend scope.');

// ══════════════════════════════════════════════════════════════
// CHECK 8 — Tenant-isolation architecture  (R11 · I74)
// ══════════════════════════════════════════════════════════════
// The architectural contract R9 established and R11 completed:
//
//   A service that resolves, mutates or deletes a tenant-owned row takes
//   `workspaceId` as a parameter and enforces it ITSELF.
//
// This does not try to prove isolation for every Prisma call — that would be a
// static analysis this script has no business attempting, and a rule that
// pretends to prove something it cannot is worse than no rule. It watches the
// specific seam that has repeatedly regressed: a scoped service quietly losing
// its workspace argument, or its scoped predicate, while its callers keep
// compiling because the parameter was positional.
//
// Deliberately a LIST, not a heuristic. Adding a service here is a decision a
// human makes when they write one; inferring it would produce a rule that is
// simultaneously noisy and easy to slip past.
section('CHECK 8: Tenant isolation — scoped services keep their workspace');

const WORKSPACE_SCOPED_SERVICES = [
  ['getArtifact',                   'src/services/artifact-storage/index.js'],
  ['deleteArtifact',                'src/services/artifact-storage/index.js'],
  ['getCheckpointById',             'src/services/execution-checkpoint/index.js'],
  ['getLatestCheckpoint',           'src/services/execution-checkpoint/index.js'],
  ['markCheckpointResumed',         'src/services/execution-checkpoint/index.js'],
  ['getApprovalStatus',             'src/services/artifact-approval/index.js'],
  ['getApproval',                   'src/services/artifact-approval/index.js'],
  ['decideApproval',                'src/services/artifact-approval/index.js'],
  ['executeDecision',               'src/services/approval-decision/index.js'],
  ['resumeExecutionFromCheckpoint', 'src/services/execution-runtime/RuntimeOrchestrator.js'],
  ['resolveAttribution',            'src/services/execution/decisionAttribution.js'],
  ['stampDecisionExecuted',         'src/services/execution/decisionAttribution.js'],
  ['resolveCredential',             'src/services/connectors/credentialStore.js'],
  ['updateCredentialAccount',       'src/services/connectors/credentialStore.js'],
];

let isolationPass = true;
for (const [fn, relPath] of WORKSPACE_SCOPED_SERVICES) {
  const src = readFile(join(ROOT, relPath));
  if (!src) {
    fail(`Tenant isolation: ${relPath} not found (did ${fn}() move?)`);
    isolationPass = false;
    continue;
  }

  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(([^)]*)\\)`);
  const m = src.match(decl);
  if (!m) {
    fail(`Tenant isolation: ${fn}() not found in ${relPath}`);
    isolationPass = false;
    continue;
  }

  // Two halves of the same contract: it must ACCEPT a workspace, and it must
  // USE one. A parameter that is accepted and ignored is the more dangerous of
  // the two failures, because every caller still looks correct.
  const params = m[1];
  const body   = src.slice(m.index, m.index + 2000);

  if (!/workspaceId/.test(params)) {
    fail(`Tenant isolation: ${fn}() no longer takes workspaceId (${relPath})`);
    fail(`  → A tenant-owned service enforces its own scope. "The caller checks it" is not a property of this function.`);
    isolationPass = false;
  } else if (!/workspaceId/.test(body.slice(params.length))) {
    fail(`Tenant isolation: ${fn}() takes workspaceId but never uses it (${relPath})`);
    fail(`  → An accepted-and-ignored scope argument is worse than none: every caller still reads as correct.`);
    isolationPass = false;
  }
}
if (isolationPass) pass(`All ${WORKSPACE_SCOPED_SERVICES.length} workspace-scoped services still take and enforce workspaceId`);

// ══════════════════════════════════════════════════════════════
// CHECK 9 — MIGRATION ROLLOUT COMPATIBILITY (B5-01R⁗)
// ══════════════════════════════════════════════════════════════
// A migration can be valid SQL, apply cleanly, and still break a rolling
// deploy — render.yaml runs lumi-backend and lumi-worker independently with no
// ordering, so old and new instances overlap on every deploy. This classifies
// each migration's operations and requires anything that is not
// rollout-COMPATIBLE to be declared, by name, with a reason.
//
// Lives here on purpose: `npm run arch-check` is what the local loop and CI's
// architecture audit both run. A migration checker nobody invokes is not a
// contract, it is a script.
section('MIGRATION ROLLOUT COMPATIBILITY');
{
  const scan = scanMigrations(fsForMigrations, pathForMigrations, join(ROOT, 'prisma/migrations'));
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/migrationCompatibility.baseline.json'), 'utf8'));
  delete baseline.$comment;
  const counts = summarise(scan);
  const result = verifyAgainstBaseline(scan, baseline);

  console.log(`  ${scan.length} migrations — `
    + `${counts.COMPATIBLE} compatible, ${counts.TRANSITION_REQUIRED} transitional, `
    + `${counts.INCOMPATIBLE} incompatible, ${counts.UNKNOWN} unknown`);

  for (const m of result.undeclared) {
    const ops = [...new Set(m.operations.filter((o) => o.cls !== 'COMPATIBLE').map((o) => o.id))];
    fail(`Migration is not rollout-safe and is not declared: ${m.name} → ${m.verdict}`);
    if (ops.length) fail(`  → ${ops.join(', ')}`);
    for (const u of m.unknown.slice(0, 2)) fail(`  → unclassifiable SQL: ${u}`);
    fail('  → Old and new instances overlap on every deploy. Either rewrite it as an');
    fail('     additive step, or declare it in scripts/migrationCompatibility.baseline.json');
    fail('     with a reason saying why the overlap is acceptable.');
  }
  for (const line of [...result.mismatched, ...result.stale, ...result.unreasoned]) fail(line);

  if (result.ok) {
    pass(`Every non-compatible migration is declared with a reason `
      + `(${counts.TRANSITION_REQUIRED + counts.INCOMPATIBLE + counts.UNKNOWN} entries)`);
  }
}

// ══════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log(`Architecture Check Results:`);
console.log(`  Scope: ${includeFrontend ? 'backend + legacy frontend' : 'backend only'}`);
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
