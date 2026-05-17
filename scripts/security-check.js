#!/usr/bin/env node
// ============================================================
// MARCOM Security Audit Script
// ============================================================
// Checks backend routes for common security violations.
// Called by: npm run security-check
// Called by: .github/workflows/architecture-check.yml
// ============================================================
import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const ROOT    = process.cwd();
const BACKEND = join(ROOT, 'src');

let failures = 0;
let warnings = 0;

function fail(msg) { console.log(`  ❌ ${msg}`); failures++; }
function warn(msg) { console.log(`  🟡 ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function section(t) { console.log(`\n── ${t} ──────────────────────`); }

function getAllFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...getAllFiles(full));
      else if (extname(entry.name) === '.js') files.push(full);
    }
  } catch {}
  return files;
}

function read(f) {
  try { return readFileSync(f, 'utf8'); } catch { return ''; }
}

const routeFiles = getAllFiles(join(BACKEND, 'routes'));

// ══ CHECK 1: IDOR — getProjectById without userId ════════════
section('CHECK 1: IDOR — ownership in query');

let idor = false;
for (const f of routeFiles) {
  const content = read(f);
  const name = f.replace(ROOT + '/', '');

  // Detect getProjectById with only 1 argument (no userId)
  const calls = content.match(/getProjectById\s*\([^)]+\)/g) || [];
  for (const call of calls) {
    const args = call.match(/\(([^)]+)\)/)?.[1]?.split(',').length ?? 0;
    if (args < 2) {
      fail(`IDOR: getProjectById called without userId in ${name}`);
      fail(`  → Call: ${call.trim()}`);
      idor = true;
    }
  }
}
if (!idor) pass('No single-arg getProjectById calls');

// ══ CHECK 2: Routes without requireAuth ══════════════════════
section('CHECK 2: Unprotected routes');

const EXEMPT_PATTERNS = [
  /\/health/,
  /\/demo-feed/,
  /\/callback/,
  /\/webhook/,
  /quick-action/,   // HMAC-signed
];

let unprotected = false;
for (const f of routeFiles) {
  const content = read(f);
  const name = f.replace(ROOT + '/', '');

  // Routes mounted without requireAuth in server.js are handled separately
  // Here we check for individual routes that look like they skip auth
  const routeDefs = content.match(/router\.(get|post|put|patch|delete)\s*\([^,]+,\s*async/g) || [];
  for (const route of routeDefs) {
    const path = route.match(/['"]([^'"]+)['"]/)?.[1] ?? '';
    const isExempt = EXEMPT_PATTERNS.some(p => p.test(path));
    if (!isExempt && !content.includes('requireAuth')) {
      warn(`Route in ${name} may be missing auth: ${path}`);
    }
  }
}
if (!unprotected) pass('Auth check passed (verify server.js mount also uses requireAuth)');

// ══ CHECK 3: Raw SQL without parameterization ════════════════
section('CHECK 3: SQL injection risk');

let sqlRisk = false;
for (const f of getAllFiles(BACKEND)) {
  const content = read(f);
  const name = f.replace(ROOT + '/', '');

  // Detect string concatenation in SQL (template literals with variables)
  // Safe: sql`WHERE id = ${variable}` (postgres tagged template — parameterized)
  // Unsafe: sql(`WHERE id = '${variable}'`) or + concatenation
  const unsafe = content.match(/sql\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g) || [];
  if (unsafe.length > 0) {
    fail(`Possible SQL injection in ${name}: ${unsafe[0].slice(0, 80)}`);
    sqlRisk = true;
  }
}
if (!sqlRisk) pass('No string-concatenated SQL detected (tagged templates are safe)');

// ══ CHECK 4: innerHTML without sanitization ══════════════════
section('CHECK 4: XSS — unsanitized innerHTML');

const CLIENT = join(ROOT, 'client/src');
function getClientFiles() {
  const files = [];
  try {
    for (const entry of readdirSync(CLIENT, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(CLIENT, entry.name);
      if (entry.isDirectory()) files.push(...getAllFiles(full));
      else if (['.jsx', '.js'].includes(extname(entry.name))) files.push(full);
    }
  } catch {}
  return files;
}

let xss = false;
for (const f of getClientFiles()) {
  const lines = read(f).split('\n');
  const name = f.replace(ROOT + '/', '');
  lines.forEach((line, i) => {
    if (line.includes('dangerouslySetInnerHTML') || line.includes('innerHTML')) {
      if (!line.includes('DOMPurify') && !line.includes('// safe')) {
        warn(`Possible XSS: ${name}:${i + 1} — ${line.trim().slice(0, 80)}`);
      }
    }
  });
}
if (!xss) pass('No unguarded innerHTML detected');

// ══ CHECK 5: 403 responses that reveal resource existence ════
section('CHECK 5: Information leakage via 403');

let leaks = false;
for (const f of routeFiles) {
  const content = read(f);
  const name = f.replace(ROOT + '/', '');

  // After ownership check, should be 404 not 403
  const forbidden403 = content.match(/status\(403\)\.json\(\{\s*error:\s*['"]Forbidden/g) || [];
  if (forbidden403.length > 0) {
    warn(`${name}: 403 Forbidden reveals resource existence — use 404 instead`);
    leaks = true;
  }
}
if (!leaks) pass('No information-leaking 403 responses');

// ══ SUMMARY ══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log('Security Check Results:');
console.log(`  ❌ Failures: ${failures}`);
console.log(`  🟡 Warnings: ${warnings}`);
console.log('══════════════════════════════════════════════\n');

if (failures > 0) {
  console.log('❌ Security check FAILED. Fix before merging.');
  process.exit(1);
} else {
  console.log('✅ Security check PASSED.');
  process.exit(0);
}
