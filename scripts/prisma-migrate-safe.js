#!/usr/bin/env node
// ============================================================
// MARCOM — Safe Prisma Migration Wrapper for Render
// Handles P3005 baseline error and P3009 failed migration lock.
// Used in build script via: node scripts/prisma-migrate-safe.js
// ============================================================
import { execSync } from 'child_process';

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

let err = null;
const maxAttempts = Math.max(MAX_CONN_RETRIES, MAX_LOCK_RETRIES);
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const output = runDeploy();
    console.log(output);  // Print captured output
    console.log('✅ Migrations deployed successfully');
    process.exit(0);
  } catch (e) {
    err = e;
    const out = e.stderr?.toString() || e.stdout?.toString() || e.message || '';
    const connError = isConnectivityError(out);
    const lockTimeout = isAdvisoryLockTimeout(out);
    // Only retry pure connectivity errors, and only while attempts remain.
    // P3005/P3009 etc. mean we DID connect — fall through to recovery below.
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

{
  // err is set: the loop exhausted retries or hit a non-connectivity error.
  // err.stderr contains the actual error from Prisma
  const errorOutput = err.stderr?.toString() || err.stdout?.toString() || err.message || '';

  // Print the error output
  console.error(errorOutput);

  if (isConnectivityError(errorOutput)) {
    console.error('\n❌ Database unreachable after retries (P1001).');
    console.error('   This is a connectivity/config issue, not a migration error:');
    console.error('   • Confirm the Neon compute is active (not suspended/deleted).');
    console.error('   • Set DIRECT_URL in Render to the Neon DIRECT endpoint');
    console.error('     (host WITHOUT "-pooler") — migrations need a direct connection.\n');
    process.exit(1);
  }

  if (isAdvisoryLockTimeout(errorOutput)) {
    console.error('\n❌ Prisma migration advisory lock timed out after retries (P1002).');
    console.error('   Usually this means another deploy or manual migration is still holding the lock.');
    console.error('   If this repeats, set DIRECT_URL in Render to the Neon DIRECT endpoint');
    console.error('   (host WITHOUT "-pooler") and retry the deploy.\n');
    process.exit(1);
  }

  // P3009: Failed migration found in database
  if (errorOutput.includes('P3009')) {
    console.log('\n⚠️  Detected failed migration lock (P3009)');
    console.log('===RESOLVING FAILED MIGRATION===\n');

    try {
      // Mark the known failed migration as applied
      // SAFETY: Only this specific migration is auto-resolved
      execSync('npx prisma migrate resolve --applied "20260525000000_add_approval_decision_analytics"', {
        stdio: 'inherit',
        env: process.env,
      });

      console.log('\n===RETRYING MIGRATE DEPLOY===\n');

      // Retry the migration deploy
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: process.env,
      });

      console.log('\n✅ Migration recovery successful');
      process.exit(0);
    } catch (retryErr) {
      console.error('\n❌ Failed to resolve migration or retry deployment');
      console.error('Manual intervention required via Render Shell.\n');
      process.exit(1);
    }
  }

  // P3005: Database not empty but no migration history
  if (errorOutput.includes('P3005')) {
    console.log('\n⚠️  P3005 detected: Database needs baseline');
    console.log('📋 Auto-applying baseline migration marker...\n');

    try {
      // Mark the baseline migration as already applied (safe - no SQL executed)
      execSync('npx prisma migrate resolve --applied "20260517000000_init"', {
        stdio: 'inherit',
        env: process.env,
      });

      console.log('\n✅ Baseline applied. Retrying migration deploy...\n');

      // Retry the migration deploy
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: process.env,
      });

      console.log('✅ Migrations deployed successfully after baseline');
      process.exit(0);
    } catch (retryErr) {
      console.error('\n❌ Failed to apply baseline or retry migration');
      console.error('See RENDER-BASELINE-FIX.md for manual fix.\n');
      throw retryErr;
    }
  }

  // Other migration errors - fail deployment
  console.error('\n❌ Migration failed with unrecoverable error');
  process.exit(1);
}
