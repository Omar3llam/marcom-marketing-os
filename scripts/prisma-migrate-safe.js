#!/usr/bin/env node
// ============================================================
// MARCOM — Safe Prisma Migration Wrapper for Render
// Handles P3005 baseline error with clear instructions.
// Used in build script via: node scripts/prisma-migrate-safe.js
// ============================================================
import { execSync } from 'child_process';

console.log('===PRISMA MIGRATE DEPLOY===');

try {
  // Capture output to check for P3005 in stderr
  const output = execSync('npx prisma migrate deploy', {
    stdio: 'pipe',  // Capture instead of inherit
    env: process.env,
    encoding: 'utf-8',
  });
  console.log(output);  // Print captured output
  console.log('✅ Migrations deployed successfully');
} catch (err) {
  // err.stderr contains the actual error from Prisma
  const errorOutput = err.stderr?.toString() || err.stdout?.toString() || err.message || '';

  // Print the error output
  console.error(errorOutput);

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

  // Other migration errors
  console.error('\n❌ Migration failed:', errorOutput);
  throw err;
}
