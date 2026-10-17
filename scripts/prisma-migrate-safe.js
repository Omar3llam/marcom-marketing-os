#!/usr/bin/env node
// ============================================================
// MARCOM — Explicit Operator Migration Gate
// ============================================================
// Invoked only by the separately authorized `npm run db:migrate:deploy`.
// Never invoke from build, package lifecycle, prestart or either Render service.
// See docs/BACKEND_STABILIZATION_03A.md; startup legacy SQL is a separate OPEN gap.
//
// ── GOVERNING LAW (B5-01Q) ──────────────────────────────────────────────────
//   Migration history is evidence, not a repair tool.
//   A failed migration stays failed until someone can prove what the database
//   actually contains.
//
// This file used to break that law twice. On P3009 it ran
//
//     prisma migrate resolve --applied "20260525000000_add_approval_decision_analytics"
//
// on a hard-coded migration name, and on P3005 it did the same for the init
// migration. Neither branch looked at the database first; both keyed off a
// string in Prisma's stderr.
//
// MEASURED, on a disposable database (B5-01Q §5 P3), with that migration in a
// genuinely failed state and the `approval_decisions` table absent:
//
//     prisma-migrate-safe.js       exit 0            ← build continues
//     _prisma_migrations           66 of 66 applied  ← a second row, 0 steps
//     prisma migrate status        "Database schema is up to date!"
//     approval_decisions           MISSING
//
// Five modules read that table. They would have 500'd against a green deploy,
// with migration history stating the migration had succeeded. The recovery did
// not repair anything; it deleted the evidence that anything was wrong.
//
// So: connectivity is retried, because a cold Neon compute is a transport
// problem with a known-safe retry. Everything else that reaches the database
// and fails is TERMINAL, and this script prints what an operator needs instead
// of guessing on their behalf. See §"operator procedure" output below.
// ============================================================
import { execSync } from 'child_process';
import { classifyDiff, isUnrecognised } from './migrationDiff.js';

// Ensure DIRECT_URL is set (fallback to DATABASE_URL if not present)
// Required for Prisma Migrate on Neon pooler connections
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  console.log('⚠️  DIRECT_URL not set, falling back to DATABASE_URL');
  console.log('   (Set DIRECT_URL to Neon direct endpoint if using pooler)\n');
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

if (process.env.DIRECT_URL?.includes('-pooler.')) {
  console.warn('⚠️  DIRECT_URL appears to use a Neon pooler host.');
  console.warn('   Prisma Migrate is more reliable with the Neon direct endpoint');
  console.warn('   (usually the same host without "-pooler").\n');
}

/**
 * Build logs are retained by the platform and read by people who are not
 * necessarily the credential holder. Prisma is generally careful, but this
 * script prints raw subprocess output, so redact defensively rather than trust
 * every future Prisma error message to stay careful.
 */
const scrub = (text) => String(text ?? '').replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*@[^\s'"]*/gi, '<connection-string-redacted>');

const say = (text) => console.log(scrub(text));
const shout = (text) => console.error(scrub(text));

console.log('===PRISMA MIGRATE DEPLOY===');

// Transient connectivity (P1001) is common on serverless Postgres (Neon)
// when the compute is suspended and cold-starting — the first connect can
// time out before the endpoint wakes. Retry a bounded number of times with
// a fixed delay so a cold start self-heals instead of failing the build.
const MAX_CONN_RETRIES = Number(process.env.MIGRATE_CONN_RETRIES || 6);
const MAX_LOCK_RETRIES = Number(process.env.MIGRATE_LOCK_RETRIES || 6);
const RETRY_DELAY_MS   = Number(process.env.MIGRATE_RETRY_DELAY_MS || 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runDeploy() {
  return execSync('npx prisma migrate deploy', {
    stdio: 'pipe',  // Capture instead of inherit
    env: process.env,
    encoding: 'utf-8',
  });
}

function isConnectivityError(out) {
  return out.includes('P1001') || /Can't reach database server/i.test(out);
}

function isAdvisoryLockTimeout(out) {
  return out.includes('P1002')
    && /advisory lock|pg_advisory_lock|Timed out trying to acquire/i.test(out);
}

// ============================================================
// READ-ONLY inspection helpers
// ============================================================
// Neither of these may change the target. `migrate status` reads
// _prisma_migrations; `migrate diff` introspects the live schema. Verified
// (B5-01Q T7): running the diff against an empty database left it at 0 tables.
//
// Both address the database through `--from-schema-datasource`, i.e. the
// datasource block in prisma/schema.prisma, which resolves `directUrl` from the
// environment. `--from-url <url>` would express the same thing but would put a
// live connection string into argv, where it is visible to every process on the
// box and to anything that logs a failed command.

/** Never throws — a diagnostic that fails must not replace the error it explains. */
function migrationStatus() {
  try {
    return execSync('npx prisma migrate status', { stdio: 'pipe', env: process.env, encoding: 'utf-8' });
  } catch (e) {
    return e.stdout?.toString() || e.stderr?.toString() || '(migrate status unavailable)';
  }
}

/**
 * Does the database this operator just migrated actually satisfy schema.prisma?
 *
 * `migrate deploy` proves every migration FILE ran. It cannot prove the result
 * matches the datamodel the deployed code was generated against — that is a
 * different question, and on this repository it has a different answer: the
 * diff exits 2 even on a perfectly migrated database, because five known
 * differences are things Prisma's schema language cannot express. So the raw
 * exit code decides nothing; classification does. The allow-list is shared with
 * B5-01M's migration ratchet so the two cannot drift apart.
 */
function verifySchema() {
  console.log('\n===VERIFY DEPLOY TARGET AGAINST SCHEMA===');
  let raw = '';
  let status = 0;
  try {
    raw = execSync(
      'npx prisma migrate diff --from-schema-datasource prisma/schema.prisma'
      + ' --to-schema-datamodel prisma/schema.prisma --exit-code',
      { stdio: 'pipe', env: process.env, encoding: 'utf-8' },
    );
  } catch (e) {
    status = e.status ?? 1;
    raw = e.stdout?.toString() || e.stderr?.toString() || '';
  }

  // 0 = identical, 2 = differences found, anything else = the check itself
  // failed. A verification that could not run has not passed.
  if (status !== 0 && status !== 2) {
    shout('\n❌ SCHEMA VERIFICATION COULD NOT RUN — DEPLOYMENT STOPPED');
    shout(raw);
    shout('   The deploy target was migrated, but nothing has confirmed it matches');
    shout('   prisma/schema.prisma. Continuing would ship code against an unverified schema.\n');
    process.exit(1);
  }

  const { tolerated, blocking, extra } = classifyDiff(raw);

  // Print what is being allowed, so a passing gate SHOWS the tolerated set
  // rather than implying it by silence.
  const byEntry = new Map();
  for (const d of tolerated) byEntry.set(d.allowedBy, (byEntry.get(d.allowedBy) ?? 0) + 1);
  for (const [id, n] of byEntry) console.log(`   tolerated: ${String(n).padStart(2)} × ${id}`);

  // The database carries MORE than the datamodel names. Prisma never selects
  // these, so they cannot break a read — but they are real drift and a silent
  // one, so say so every deploy. Blocking here would turn a safety check into
  // production repair, which is explicitly not this script's job.
  if (extra.length) {
    console.warn(`\n⚠️  SCHEMA DRIFT — the database has ${extra.length} object(s) prisma/schema.prisma does not declare:`);
    for (const d of extra) console.warn(`   • ${d.table}: ${d.change}`);
    console.warn('   Not fatal: Prisma Client never names these, so no query depends on them.');
    console.warn('   They are still unmanaged state — reconcile them into a migration.\n');
  }

  if (blocking.length) {
    shout('\n❌ SCHEMA MISMATCH — DEPLOYMENT STOPPED');
    shout(`   prisma/schema.prisma requires ${blocking.length} thing(s) the deploy target does not have:`);
    for (const d of blocking) shout(`   • ${d.table}: ${d.change}`);

    // A shape the parser does not know is scored as dangerous on purpose, but
    // it must not masquerade as a confident finding — that is exactly how four
    // inert legacy tables once stopped a deploy. Say which it is.
    const gaps = blocking.filter(isUnrecognised);
    if (gaps.length) {
      shout(`\n   ⚠️  ${gaps.length} of these are lines this gate could not parse, not`);
      shout('       differences it understood. Treated as dangerous by default. If');
      shout('       `migrate diff` has a new output shape, teach scripts/migrationDiff.js');
      shout('       about it — do NOT widen the allow-list to make them disappear:');
      for (const d of gaps) shout(`       ${JSON.stringify(d.raw)}`);
    }

    shout('\n   Prisma Client selects every column the datamodel declares, so a model missing');
    shout('   a column here fails EVERY read of that model at runtime — after a green deploy.');
    shout('   Either the migration set does not express the schema (npm run test:full covers');
    shout('   that), or this database has diverged from the migrations that were applied to it.\n');
    process.exit(1);
  }

  console.log(extra.length
    ? `✅ Deploy target satisfies prisma/schema.prisma (${extra.length} unmanaged object(s) reported above)`
    : '✅ Deploy target matches prisma/schema.prisma');
}

let err = null;
let deployed = false;
const maxAttempts = Math.max(MAX_CONN_RETRIES, MAX_LOCK_RETRIES);
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const output = runDeploy();
    say(output);  // Print captured output
    console.log('✅ Migrations deployed successfully');
    deployed = true;
    break;
  } catch (e) {
    err = e;
    const out = e.stderr?.toString() || e.stdout?.toString() || e.message || '';
    const connError = isConnectivityError(out);
    const lockTimeout = isAdvisoryLockTimeout(out);
    // Only retry pure connectivity errors, and only while attempts remain.
    // P3005/P3009 etc. mean we DID connect — fall through to the terminal
    // diagnostics below. Retrying those would repeat a decided failure.
    if (connError && attempt < MAX_CONN_RETRIES) {
      console.warn(`⚠️  P1001 — can't reach DB (attempt ${attempt}/${MAX_CONN_RETRIES}). ` +
        `Neon may be cold-starting; retrying in ${RETRY_DELAY_MS}ms…`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    if (lockTimeout && attempt < MAX_LOCK_RETRIES) {
      console.warn(`⚠️  P1002 — Prisma migration advisory lock is busy ` +
        `(attempt ${attempt}/${MAX_LOCK_RETRIES}). ` +
        `Another deploy may still be migrating; retrying in ${RETRY_DELAY_MS}ms…`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    break; // non-connectivity error, or out of retries → handle below
  }
}

// Deliberately OUTSIDE the retry loop's try: a verification that throws must
// surface as a verification failure, not be mistaken for a deploy error and
// retried or routed into the P3009/P3005 diagnostics below.
if (deployed) {
  verifySchema();   // exits non-zero if the result does not match the schema
  process.exit(0);
}

{
  // err is set: the loop exhausted retries or hit a non-connectivity error.
  // err.stderr contains the actual error from Prisma
  const errorOutput = err.stderr?.toString() || err.stdout?.toString() || err.message || '';

  // Print the error output
  shout(errorOutput);

  if (isConnectivityError(errorOutput)) {
    shout('\n❌ Database unreachable after retries (P1001).');
    shout('   This is a connectivity/config issue, not a migration error:');
    shout('   • Confirm the Neon compute is active (not suspended/deleted).');
    shout('   • Set DIRECT_URL in Render to the Neon DIRECT endpoint');
    shout('     (host WITHOUT "-pooler") — migrations need a direct connection.\n');
    process.exit(1);
  }

  if (isAdvisoryLockTimeout(errorOutput)) {
    shout('\n❌ Prisma migration advisory lock timed out after retries (P1002).');
    shout('   Usually this means another deploy or manual migration is still holding the lock.');
    shout('   If this repeats, set DIRECT_URL in Render to the Neon DIRECT endpoint');
    shout('   (host WITHOUT "-pooler") and retry the deploy.\n');
    process.exit(1);
  }

  // ── P3009: a migration is recorded as started and never finished ─────────
  if (errorOutput.includes('P3009')) {
    shout('\n❌ FAILED MIGRATION IN HISTORY — DEPLOYMENT STOPPED (P3009)');
    shout('');
    shout('   The database\'s real shape is UNKNOWN. The failed migration\'s SQL may have');
    shout('   applied fully, partially, or not at all, and nothing here can tell which.');
    shout('');
    shout('   This script will NOT mark it applied. `migrate resolve --applied` writes');
    shout('   "succeeded" into migration history WITHOUT looking at the database: measured');
    shout('   on a disposable copy, it produced `migrate status` = "Database schema is up to');
    shout('   date!" and a green build while the table that migration creates was absent.');
    shout('');
    shout('── CURRENT MIGRATION STATE ──────────────────────────────────────────────');
    shout(migrationStatus());
    shout('── OPERATOR PROCEDURE (Render Shell, or psql on the same database) ──────');
    shout('   1. Take the failed migration name from the state above.');
    shout('   2. Open prisma/migrations/<name>/migration.sql and check the database for');
    shout('      EVERY object it creates (\\dt, \\d <table>, \\di).');
    shout('   3. Only then choose exactly one:');
    shout('        every object present → npx prisma migrate resolve --applied     "<name>"');
    shout('        no object present    → npx prisma migrate resolve --rolled-back "<name>"');
    shout('        partially present    → finish or undo it by hand FIRST, then use one');
    shout('                               of the two commands above.');
    shout('   4. NO-DEPLOY FREEZE: the choices above require separate incident approval.');
    shout('      A rolled-back migration remains pending for deploy selection, even when');
    shout('      Prisma 5.22 migrate status says "Database schema is up to date!" (H-1).');
    shout('      After any approved resolve, verify _prisma_migrations AND native catalogs');
    shout('      for every affected object, checksum, owner, privilege and constraint.');
    shout('      Status alone never proves schema presence or authorizes retry/redeploy.');
    shout('      Keep the current incident frozen until a separate recovery/cutover approval.\n');
    process.exit(1);
  }

  // ── P3005: the database has tables but no migration history ──────────────
  if (errorOutput.includes('P3005')) {
    shout('\n❌ DATABASE NOT UNDER MIGRATION CONTROL — DEPLOYMENT STOPPED (P3005)');
    shout('');
    shout('   The target has schema objects but no _prisma_migrations history, so its');
    shout('   provenance is unknown. Baselining it declares "everything up to migration X');
    shout('   is already applied" — an assertion about a database nobody has inspected.');
    shout('');
    shout('   This script will NOT baseline automatically. Note that 20260517000000_init is');
    shout('   NOT an empty marker: it contains real DDL for the core tables. Marking it');
    shout('   applied SKIPS that DDL and asserts those tables already exist as declared.');
    shout('');
    shout('── OPERATOR PROCEDURE ───────────────────────────────────────────────────');
    shout('   • Empty database expected? Verify the target identity before a separately approved retry.');
    shout('   • Restored/pre-existing database? Confirm which migration its schema actually');
    shout('     corresponds to, then baseline to THAT migration in a shell:');
    shout('        npx prisma migrate resolve --applied "<migration it truly matches>"');
    shout('     Any history change requires separate approval and native catalog verification.');
    shout('     Keep the current incident under NO-DEPLOY FREEZE; status is not schema proof.');
    shout('   • See DEPLOYMENT-MIGRATION-GUIDE.md → "Baselining an existing database".\n');
    process.exit(1);
  }

  // Other migration errors - fail deployment
  shout('\n❌ Migration failed with unrecoverable error');
  process.exit(1);
}
