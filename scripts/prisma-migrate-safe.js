#!/usr/bin/env node
// ============================================================
// MARCOM — Safe Prisma Migration Wrapper for Render
// Handles P3005 baseline error with clear instructions.
// Used in build script via: node scripts/prisma-migrate-safe.js
// ============================================================
import { execSync } from 'child_process';

console.log('===PRISMA MIGRATE DEPLOY===');

try {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('✅ Migrations deployed successfully');
} catch (err) {
  const errorMessage = err.message || err.toString();

  // P3005: Database not empty but no migration history
  if (errorMessage.includes('P3005')) {
    console.error('\n❌ P3005: Database needs baseline\n');
    console.error('The database has tables but Prisma doesn\'t know the baseline migration was applied.');
    console.error('\n🔧 ONE-TIME FIX (run in Render Shell):');
    console.error('   npx prisma migrate resolve --applied "20260517000000_init"\n');
    console.error('Then trigger a redeploy. See RENDER-BASELINE-FIX.md for details.\n');
    process.exit(1);
  }

  // Other migration errors
  console.error('\n❌ Migration failed:', errorMessage);
  throw err;
}
