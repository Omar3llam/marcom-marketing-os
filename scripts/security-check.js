#!/usr/bin/env node
// ============================================================
// MARCOM Security Check  (rewritten in R11 · I74)
// ============================================================
// Called by: npm run security-check
// Called by: .github/workflows/architecture-check.yml
//
// WHY THIS WAS REWRITTEN
//
// The previous version reported "Security check PASSED" on every R10 gate
// while every finding R11 fixes was already present in the tree. It could not
// have done otherwise:
//
//   * CHECK 2 ("Unprotected routes") initialised `unprotected = false` and
//     never assigned it. It only ever called warn(), and warnings do not fail.
//     The check could not fail, and printed a pass line either way.
//   * CHECK 1 matched ONE legacy symbol name (`getProjectById`) and knew
//     nothing about resolveCredential, getArtifact, getCheckpointById,
//     resolveAttribution, executeDecision or any other scoped resolver.
//   * CHECK 5 warned about a response shape rather than a security property.
//
// A control that always passes is not a control; it is a claim. The rules below
// assert properties R11 established, each phrased so that REMOVING the fix
// makes the rule fail. That is the whole design brief: every rule here is a
// mutation test executed by grep.
//
// SCOPE. This is a static gate, deliberately narrow. It looks for the specific
// shapes whose reintroduction would silently undo an R11 invariant. It does not
// attempt to prove tenant isolation in general — that is what the negative
// controls in the test suite are for, and a scanner that pretended otherwise
// would be exactly the theatre this replaces.
// ============================================================
import { verificationScope } from './verificationScope.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname, relative, sep } from 'path';

const ROOT    = process.cwd();
const { includeFrontend } = verificationScope(ROOT);
const BACKEND = join(ROOT, 'src');
const CLIENT  = join(ROOT, 'client', 'src');

let failures = 0;
let warnings = 0;

function fail(msg) { console.log(`  ❌ ${msg}`); failures++; }
function warn(msg) { console.log(`  🟡 ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`); }

function allFiles(dir, exts = ['.js']) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full, exts));
    else if (exts.includes(extname(entry.name))) out.push(full);
  }
  return out;
}

const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const rel  = (f) => relative(ROOT, f).split(sep).join('/');

/**
 * Blank out comment-only lines, preserving line count so reported line numbers
 * still point at the real thing.
 *
 * This matters more than it looks. Every forbidden shape below is DESCRIBED in
 * a comment somewhere near the code that no longer does it — that is how the
 * fixes explain themselves — and a scanner that cannot tell the description
 * from the deed reports the explanation as the violation. The first run of this
 * rewritten gate did exactly that, four times.
 *
 * Line-granular rather than a real parser: this codebase writes block comments
 * with a leading `*` on every line, so nothing subtler is needed, and a scanner
 * should not be the most complicated thing it guards.
 */
function stripComments(src) {
  let inBlock = false;
  return src.split('\n').map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return '';
    }
    if (t.startsWith('//')) return '';
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
    if (t.startsWith('*')) return '';
    return line;
  }).join('\n');
}

const backendFiles = allFiles(BACKEND).filter((f) => !f.includes('.test.'));
const clientFiles  = includeFrontend ? allFiles(CLIENT, ['.js', '.jsx']).filter((f) => !f.includes('.test.')) : [];
const sourceOf     = new Map(backendFiles.map((f) => [f, stripComments(read(f))]));
/** Raw text, for the require_() rules — those look FOR a shape, comments included. */
const rawOf        = new Map(backendFiles.map((f) => [f, read(f)]));

/**
 * The core primitive: a forbidden shape, and the invariant it would break.
 * Every rule below is expressed this way so the report says WHAT broke and WHY
 * it matters, not just that a regex matched.
 */
function forbid({ id, title, pattern, files = backendFiles, why, allow = () => false, severity = 'fail' }) {
  const hits = [];
  for (const f of files) {
    const src = sourceOf.get(f) ?? stripComments(read(f));
    for (const m of src.matchAll(pattern)) {
      const line = src.slice(0, m.index).split('\n').length;
      if (allow({ file: f, match: m[0], src, line })) continue;
      hits.push({ file: rel(f), line, match: m[0].replace(/\s+/g, ' ').slice(0, 100) });
    }
  }
  if (hits.length === 0) { pass(`${id} — ${title}`); return; }
  for (const h of hits) {
    (severity === 'fail' ? fail : warn)(`${id} — ${title}`);
    console.log(`       ${h.file}:${h.line}  ${h.match}`);
  }
  console.log(`       ↳ ${why}`);
}

/** The inverse: a shape that MUST be present. */
function require_({ id, title, file, pattern, why }) {
  const full = join(ROOT, file);
  const raw = read(full);
  if (!raw) { fail(`${id} — ${title}: ${file} not found`); return; }
  // Comments are stripped for the same reason `forbid` strips them, in the
  // opposite direction: a required guard must be satisfied by CODE. Read raw,
  // a rule is satisfied by a comment that merely names the thing it demands —
  // including the comment written above the guard to explain it, which survives
  // the guard's own deletion. Caught by mutating out the network self-exclusion
  // and watching the rule pass anyway.
  const src = stripComments(raw);
  if (pattern.test(src)) { pass(`${id} — ${title}`); return; }
  fail(`${id} — ${title}`);
  console.log(`       ${file} no longer contains the required guard`);
  console.log(`       ↳ ${why}`);
}

// ════════════════════════════════════════════════════════════
section('IDENTITY (I56 / I57 / I58)');

require_({
  id: 'SEC-ID-1',
  title: 'the ADMIN allowlist is gated on a VERIFIED email',
  file: 'src/middleware/firebaseAuth.js',
  pattern: /email_verified\s*===\s*true/,
  why: 'Firebase mints an identity for any address typed into the signup form. Without email_verified, registering an ADMIN_EMAILS address grants the admin panel.',
});

require_({
  id: 'SEC-ID-2',
  title: 'invitation membership is claimed by TOKEN, atomically',
  file: 'src/middleware/firebaseAuth.js',
  pattern: /invitation\.updateMany\(\{[\s\S]{0,200}?token:/,
  why: 'An email match alone must never grant workspace membership — the invitation token is the credential, and its claim must be single-use.',
});

forbid({
  id: 'SEC-ID-3',
  title: 'a User row is resolved by email',
  pattern: /OR:\s*\[[^\]]*\{\s*email\b[^\]]*\]/g,
  why: 'User.clerkId (the Firebase uid) is the sole identity key. Resolving a User by email is how an attacker adopts an existing account by registering its address.',
});

forbid({
  id: 'SEC-ID-4',
  title: 'clerkId is REASSIGNED on an existing User row',
  // Deliberately targets `update`, not `create`. Creating a row with a clerkId
  // is how an identity is established; writing one onto a row that already
  // exists is how an identity is STOLEN — the row is found by some other
  // predicate and then re-pointed at the caller. That was the takeover.
  pattern: /user\.update(?:Many)?\(\{[\s\S]{0,300}?data:\s*\{[^}]*\bclerkId\b/g,
  why: 'clerkId is the identity key. A handler that writes it onto an existing row is re-pointing that account at the caller.',
});

forbid({
  id: 'SEC-ID-5',
  title: 'a canonical identity field is ASSIGNED from the request',
  // The invariant is about ASSIGNMENT, not mention: `req.query.role` used as a
  // list filter, or `req.body.collabRole` naming which role to give someone
  // else, are ordinary data. `req.workspaceId = req.body.workspaceId` is the
  // defect — a caller nominating their own tenant.
  pattern: /req\.(?:userId|workspaceId|userRole|collabRole)\s*=\s*req\.(?:body|query|params)\b/g,
  why: 'req.userId / req.workspaceId / req.userRole / req.collabRole are middleware-owned. A request value must never stand in for one.',
});

// ════════════════════════════════════════════════════════════
section('AUTHORIZATION (I61 / I62)');

require_({
  id: 'SEC-AZ-1',
  title: 'requireCollabRole fails CLOSED on an unresolvable role',
  file: 'src/middleware/requireCollabRole.js',
  pattern: /throw new RoleUnavailableError/,
  why: 'A swallowed DB error used to fall through to STRATEGIST — the highest privilege in the product. An outage must deny, not promote.',
});

forbid({
  id: 'SEC-AZ-2',
  title: 'the ENFORCEMENT resolver defaults a null role to a role',
  files: [join(BACKEND, 'middleware', 'requireCollabRole.js')],
  // Scoped to resolveCollabRole's own body. resolveCollabRoleForDisplay
  // legitimately defaults — display is generous, enforcement is strict, and
  // conflating the two in either direction is the bug.
  pattern: /export async function resolveCollabRole\s*\([\s\S]*?\n\}/g,
  allow: ({ match }) => !/return normalizeRole\(null\)/.test(match),
  why: 'normalizeRole(null) returns STRATEGIST. In the ENFORCEMENT path that is a fail-open default; display may still use it, enforcement may not.',
});

forbid({
  id: 'SEC-AZ-3',
  title: 'a dev override is read directly from process.env',
  pattern: /process\.env\.(?:PLAN_OVERRIDE|COLLAB_ROLE_OVERRIDE|MEASUREMENT_TIER_OVERRIDE)/g,
  why: 'These must be read through devOverride(), which is inert in production. Read directly, one stray value rewrites the entitlement, role or paywall for every request.',
  allow: ({ file }) => /lib[\\/]devOverrides\.js$/.test(file),
});

require_({
  id: 'SEC-AZ-4',
  title: 'dev overrides are inert in production',
  file: 'src/lib/devOverrides.js',
  pattern: /NODE_ENV\s*===\s*'production'\)\s*\{[\s\S]*?return null;/,
  why: 'An authorization override present in a production environment is a bypass with an innocent name.',
});

// ════════════════════════════════════════════════════════════
section('TENANCY (I64 / I65)');

const SCOPED_SERVICES = [
  'getArtifact', 'deleteArtifact', 'getCheckpointById', 'getLatestCheckpoint',
  'markCheckpointResumed', 'getApprovalStatus', 'getApproval', 'resolveCredential',
  'resolveAttribution', 'executeDecision', 'resumeExecutionFromCheckpoint',
  'approveArtifact', 'rejectArtifact', 'requestRevision', 'decideApproval',
];

section('  scoped resolvers still demand a workspace');
{
  let missing = 0;
  for (const fn of SCOPED_SERVICES) {
    const declared = backendFiles.some((f) => {
      const src = sourceOf.get(f) ?? '';
      const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(([^)]*)\\)`);
      const m = src.match(decl);
      if (!m) return false;
      // The guard is either a workspaceId parameter that is checked, or a
      // scoped WHERE built from one.
      const body = src.slice(m.index, m.index + 1400);
      return /workspaceId/.test(m[1]) && /workspaceId/.test(body);
    });
    if (!declared) {
      fail(`SEC-TN-1 — ${fn}() no longer takes and uses workspaceId`);
      console.log('       ↳ R9/R11: a tenant-owned resolver takes workspaceId as an ARGUMENT and enforces it itself. "The caller checks it" is not a property of the service.');
      missing++;
    }
  }
  if (missing === 0) pass(`SEC-TN-1 — all ${SCOPED_SERVICES.length} scoped services still require workspaceId`);
}

forbid({
  id: 'SEC-TN-2',
  title: 'the execution idempotency key is looked up unscoped',
  pattern: /executionRequest\.findUnique\(\{\s*where:\s*\{\s*idempotencyKey\b/g,
  why: 'idempotencyKey is client-supplied. Looked up without a workspace it returns another tenant\'s executionId, status and raw Meta response — and lets a key be pre-claimed to fake their success.',
});

require_({
  id: 'SEC-TN-3',
  title: 'idempotency uniqueness is workspace-qualified in the schema',
  file: 'prisma/schema.prisma',
  pattern: /@@unique\(\[workspaceId,\s*idempotencyKey\]\)/,
  why: 'A globally unique, client-controlled key is a namespace shared across every tenant.',
});

require_({
  id: 'SEC-TN-4',
  title: 'approval decisions are PENDING-gated inside the service',
  file: 'src/services/artifact-approval/index.js',
  pattern: /status:\s*APPROVAL_STATUS\.PENDING[\s\S]{0,120}?data,/,
  why: 'Without the precondition in the WHERE, a REJECTED approval can be flipped to APPROVED, repeatedly, overwriting the reviewer each time.',
});

require_({
  id: 'SEC-TN-5',
  title: 'quick-action tokens bind the workspace and the actor',
  file: 'src/utils/hmac.js',
  pattern: /function canonical\(\{[^}]*\bwid\b[^}]*\bact\b/,
  why: 'A signed link that names only the action is valid for that action in ANY workspace, on behalf of ANYONE — and the audit cannot say who acted.',
});

forbid({
  id: 'SEC-TN-6',
  title: 'network cohort membership is taken from the request',
  pattern: /cohortTag:\s*req\.(body|query|params)/g,
  why: 'A cohort decides both whose patterns you contribute to and whose aggregate you may read. Accepted from the caller it is an unverified claim: name a cohort and you are inside it. k-anonymity protects the contributors, not the boundary.',
});

require_({
  id: 'SEC-TN-7',
  title: 'the network aggregate excludes the requesting workspace',
  file: 'src/services/network-engine/NetworkService.js',
  pattern: /id:\s*\{\s*not:\s*workspaceId\s*\}/,
  why: '"Across N consenting accounts" must mean N OTHERS. Including self returns an account\'s own history to it as independent corroboration, and downstream Planning and Scenario surfaces consume it as such.',
});

// ════════════════════════════════════════════════════════════
section('EXTERNAL EXECUTION (I67 / I68)');

require_({
  id: 'SEC-EX-1',
  title: 'the worker re-authorizes the job against the persisted row',
  file: 'src/workers/executionWorker.js',
  pattern: /execution\.workspaceId\s*!==\s*workspaceId/,
  why: 'job.data.workspaceId chose which workspace\'s Meta credential to use and was never compared to the row. A queue payload is not an authorization.',
});

forbid({
  id: 'SEC-EX-2',
  title: 'the worker prefers job data over persisted state',
  files: [join(BACKEND, 'workers', 'executionWorker.js')],
  pattern: /(?:actionType|targetId)\s*\?\?\s*execution\./g,
  why: 'The row records what a route authorized. Where the job disagrees, the job is wrong by definition — it must be refused, not preferred.',
});

require_({
  id: 'SEC-EX-3',
  title: 'targetId is format-validated before it reaches a URL path',
  file: 'src/services/meta/mutationParams.js',
  pattern: /\^\(act_\)\?\\d\{1,32\}\$/,
  why: 'targetId is interpolated into the Graph API path. Accepted as any string it carries /, ? and &, so the caller controls the path and query of an authenticated POST made with the workspace\'s token.',
});

forbid({
  id: 'SEC-EX-4',
  title: 'caller-supplied options are forwarded to Meta wholesale',
  pattern: /new URLSearchParams\(\s*(?:options|data)\b[^)]*\)/g,
  why: 'That turns an action endpoint into a generic Graph API proxy with the workspace\'s credential attached. Fields must come from an explicit allowlist.',
});

forbid({
  id: 'SEC-EX-5',
  title: 'a credential is placed in a URL',
  pattern: /[?&](?:access_token|client_secret|fb_exchange_token|refresh_token)=\$\{/g,
  why: 'URLs are recorded by access logs, proxies and APM spans; headers and request bodies are not. Use Authorization: Bearer, or a POST body.',
});

// ════════════════════════════════════════════════════════════
section('SECRETS & TRANSPORT (I68 / I72)');

require_({
  id: 'SEC-SC-1',
  title: 'CREDENTIAL_ENCRYPTION_KEY and OAUTH_STATE_SECRET are required at boot',
  file: 'src/config.js',
  pattern: /REQUIRED_IN_PRODUCTION[\s\S]{0,200}?CREDENTIAL_ENCRYPTION_KEY[\s\S]{0,120}?OAUTH_STATE_SECRET/,
  why: 'Without the encryption key every stored token is unreadable, and the product renders that as "not connected" — a total credential outage disguised as a fresh account.',
});

require_({
  id: 'SEC-SC-2',
  title: 'OAuth state does not share the webhook secret',
  file: 'src/routes/auth/oauthState.js',
  pattern: /OAUTH_STATE_SECRET/,
  why: 'One key for two trust domains means a leak in either forges the other, and rotating for one breaks the other in the same instant.',
});

require_({
  id: 'SEC-SC-3',
  title: 'database TLS verifies the server certificate in production',
  file: 'src/utils/db.js',
  pattern: /rejectUnauthorized:\s*process\.env\.NODE_ENV\s*===\s*'production'/,
  why: 'rejectUnauthorized:false encrypts without authenticating. This pool carries the encrypted OAuth tokens for customers\' ad accounts, over the public internet.',
});

require_({
  id: 'SEC-SC-4',
  title: 'log redaction covers token-shaped fields',
  file: 'src/utils/logger.js',
  pattern: /accessToken[\s\S]{0,200}?refreshToken/,
  why: 'The original redact list named none of the fields the OAuth code actually uses, so any wholesale log of a credential object printed it.',
});

if (includeFrontend) require_({
  id: 'SEC-SC-5',
  title: 'production builds emit no source maps',
  file: 'client/vite.config.js',
  pattern: /sourcemap:\s*false/,
  why: 'express.static served client/dist/**/*.js.map, publishing the full un-minified frontend.',
});

// ════════════════════════════════════════════════════════════
section('RATE LIMITING (E1)');

forbid({
  id: 'SEC-RL-1',
  title: 'a limiter keys on req.auth (a removed Clerk artifact)',
  pattern: /req\.auth\??\.\s*userId/g,
  why: 'req.auth has been undefined since the Firebase migration, so every limiter using it silently degraded to per-IP counting. The Firebase identity is req.userId.',
});

require_({
  id: 'SEC-RL-2',
  title: 'limiters name their principal explicitly',
  file: 'src/middleware/rateLimit.js',
  pattern: /const byUser[\s\S]{0,400}?const byWorkspace[\s\S]{0,400}?const byIp/,
  why: 'The correct principal differs per resource: a person for the general surface, an account for anything spending money, an IP for brute-force guards.',
});

// ════════════════════════════════════════════════════════════
section('SQL & XSS (retained from the original gate)');

forbid({
  id: 'SEC-SQL-1',
  title: 'SQL is built by interpolation rather than a tagged template',
  pattern: /\bsql\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g,
  why: 'postgres.js parameterises sql`…` tagged templates. sql(`…${x}…`) is plain concatenation.',
});

forbid({
  id: 'SEC-SQL-2',
  title: '$queryRawUnsafe / $executeRawUnsafe is used',
  pattern: /\$(?:query|execute)RawUnsafe\s*\(/g,
  why: 'The Unsafe variants take a pre-built string. Use $queryRaw with a tagged template so values are parameterised.',
});

if (includeFrontend) {
  let xssHits = 0;
  for (const f of clientFiles) {
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      if (!/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line)) return;
      if (/DOMPurify|\/\/ safe/.test(line)) return;
      warn(`SEC-XSS-1 — unsanitised HTML injection`);
      console.log(`       ${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
      xssHits++;
    });
  }
  if (xssHits === 0) pass('SEC-XSS-1 — no unguarded innerHTML in the client');
} else console.log('Frontend source-map and XSS rules: outside backend scope; run full legacy verification separately.');

// ════════════════════════════════════════════════════════════
section('SUPPLY CHAIN');

{
  const pkg = JSON.parse(read(join(ROOT, 'package.json')) || '{}');
  const deps = Object.keys(pkg.dependencies || {});
  // Runtime deps that are imported nowhere are pure attack surface: they ship
  // to production, their transitive tree is audited against us, and nothing
  // breaks if they are removed — which is precisely why nobody notices them.
  const KNOWN_INDIRECT = new Set([
    'dotenv', 'pino-pretty',        // loaded by name / by pino at runtime
    '@prisma/client', 'prisma',     // generated client + CLI
    'ioredis', 'bullmq',            // imported through queue modules
  ]);
  // scripts/ counts as an importer: a maintenance script is not production
  // runtime, but its dependency is genuinely in use and removing it would
  // break the script. The question this rule asks is "is anything using this",
  // not "is production using this".
  const haystack = [...backendFiles, ...clientFiles, ...allFiles(join(ROOT, 'scripts'))]
    .map((f) => rawOf.get(f) ?? read(f)).join('\n');

  const unused = deps.filter((d) => {
    if (KNOWN_INDIRECT.has(d)) return false;
    return !haystack.includes(`'${d}'`) && !haystack.includes(`"${d}"`)
      && !haystack.includes(`'${d}/`) && !haystack.includes(`"${d}/`);
  });

  if (unused.length === 0) pass('SEC-SUP-1 — every production dependency has an importer');
  else {
    for (const d of unused) fail(`SEC-SUP-1 — production dependency with no importer: ${d}`);
    console.log('       ↳ An unused runtime dependency ships to production and drags its transitive CVEs with it, while nothing in the app would notice its removal.');
  }
}

// ════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════');
console.log('Security Check Results:');
console.log(`  ❌ Failures: ${failures}`);
console.log(`  🟡 Warnings: ${warnings}`);
console.log('══════════════════════════════════════════════\n');

if (failures > 0) {
  console.log('❌ Security check FAILED. Fix before merging.');
  process.exit(1);
}
console.log('✅ Security check PASSED.');
process.exit(0);
