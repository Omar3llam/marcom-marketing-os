// ============================================================
// MARCOM v4.1 — Complete Data Reset Script
// ============================================================
// PURPOSE: Reset entire application to clean first-install state
//          for onboarding validation.
//
// SAFETY: This script deletes ALL user-generated data from:
//         - PostgreSQL database (via Prisma)
//         - Firebase Authentication
//         - BullMQ job queues
//
// PRESERVES:
//         - Schema / migrations
//         - Source code
//         - Environment configuration
//         - Queue infrastructure
//
// USAGE: node scripts/reset-to-first-install.js
// ============================================================

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';
import { Queue } from 'bullmq';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Initialize Prisma
const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════
// STEP 0: SAFETY CHECKS
// ══════════════════════════════════════════════════════════════

async function runSafetyChecks() {
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│        MARCOM DATA RESET — SAFETY CHECK                 │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  // Check database connection
  console.log('🔍 Checking database connection...\n');
  try {
    const dbInfo = await prisma.$queryRaw`
      SELECT
        current_database() as database,
        current_user as user,
        pg_postmaster_start_time() as started_at
    `;
    console.log('📊 Database Info:');
    console.log(`   Database: ${dbInfo[0].database}`);
    console.log(`   User: ${dbInfo[0].user}`);
    console.log(`   Started: ${dbInfo[0].started_at}\n`);
  } catch (error) {
    console.error('❌ Failed to connect to database:', error.message);
    process.exit(1);
  }

  // Check DATABASE_URL for production patterns
  const databaseUrl = process.env.DATABASE_URL || '';
  const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@'); // Mask password
  console.log(`🔗 DATABASE_URL: ${maskedUrl}\n`);

  const productionPatterns = [
    'prod',
    'production',
    'render.com',
    'onrender.com',
    'railway.app',
    'supabase.co',
    'aws.com',
    'azure.com',
  ];

  const isProduction = productionPatterns.some(pattern =>
    databaseUrl.toLowerCase().includes(pattern)
  );

  if (isProduction) {
    console.error('❌ CRITICAL ERROR: Database URL matches production pattern!');
    console.error('   This script is designed for local development only.');
    console.error('   Exiting immediately to prevent data loss.\n');
    process.exit(1);
  }

  console.log('✅ Database URL safety check passed (no production patterns detected)\n');

  // Check Firebase configuration
  console.log('🔍 Checking Firebase configuration...\n');

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY not set');
    console.error('   Cannot proceed without Firebase Admin credentials.\n');
    process.exit(1);
  }

  try {
    // Initialize Firebase Admin if not already initialized
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    const projectId = admin.app().options.projectId || 'unknown';
    console.log(`🔥 Firebase Project: ${projectId}\n`);

    if (projectId && (projectId.includes('prod') || projectId.includes('production'))) {
      console.error('❌ CRITICAL ERROR: Firebase project appears to be production!');
      console.error('   Exiting immediately to prevent data loss.\n');
      process.exit(1);
    }

    console.log('✅ Firebase configuration check passed\n');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
    console.error('   Error details:', error.stack);
    process.exit(1);
  }

  // List tables that will be cleared
  console.log('📋 Tables that will be CLEARED (all user data deleted):\n');
  const tablesToClear = [
    'ExecutionTransition',
    'ExecutionMetric',
    'ExecutionCheckpoint',
    'ApprovalDecision',
    'ProviderPerformanceMetrics',
    'PublishedCreative',
    'ArtifactApproval',
    'Artifact',
    'ExecutionRequest',
    'AuditLog',
    'Integration',
    'User',
    'Workspace',
    'WebhookEvent',
    'ReinforcementSnapshot',
  ];
  tablesToClear.forEach((table, i) => {
    console.log(`   ${i + 1}. ${table}`);
  });

  console.log('\n📋 Tables that will be PRESERVED:\n');
  console.log('   - _prisma_migrations (migration history)\n');

  // Require typed confirmation
  console.log('⚠️  WARNING: This operation is IRREVERSIBLE!\n');
  console.log('   All user data will be permanently deleted from:');
  console.log('   - PostgreSQL database');
  console.log('   - Firebase Authentication');
  console.log('   - BullMQ job queues\n');

  const confirmed = await getUserConfirmation();
  if (!confirmed) {
    console.log('\n❌ Operation cancelled by user.\n');
    process.exit(0);
  }

  console.log('\n✅ Confirmation received. Proceeding with data reset...\n');
}

async function getUserConfirmation() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Type exactly "RESET MARCOM DATA" to continue (or Ctrl+C to abort): ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'RESET MARCOM DATA');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// STEP 1-3: DATABASE CLEANUP
// ══════════════════════════════════════════════════════════════

async function clearDatabase() {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│             DATABASE CLEANUP                            │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const beforeCounts = {};
  const afterCounts = {};
  const deletionResults = {};

  console.log('📊 Collecting pre-deletion counts...\n');

  // Get counts before deletion
  beforeCounts.executionTransition = await prisma.executionTransition.count();
  beforeCounts.executionMetric = await prisma.executionMetric.count();
  beforeCounts.executionCheckpoint = await prisma.executionCheckpoint.count();
  beforeCounts.approvalDecision = await prisma.approvalDecision.count();
  beforeCounts.providerPerformanceMetrics = await prisma.providerPerformanceMetrics.count();
  beforeCounts.publishedCreative = await prisma.publishedCreative.count();
  beforeCounts.artifactApproval = await prisma.artifactApproval.count();
  beforeCounts.artifact = await prisma.artifact.count();
  beforeCounts.executionRequest = await prisma.executionRequest.count();
  beforeCounts.auditLog = await prisma.auditLog.count();
  beforeCounts.user = await prisma.user.count();
  beforeCounts.workspace = await prisma.workspace.count();
  beforeCounts.webhookEvent = await prisma.webhookEvent.count();
  beforeCounts.reinforcementSnapshot = await prisma.reinforcementSnapshot.count();
  beforeCounts.migrations = await prisma.$queryRaw`SELECT COUNT(*) FROM "_prisma_migrations"`.then(r => Number(r[0].count));

  console.log('Before deletion:');
  console.table(beforeCounts);

  console.log('\n🗑️  Deleting in FK dependency order...\n');

  try {
    // Layer 1: Deepest children (no FK dependencies from other tables)
    console.log('Layer 1: Execution lifecycle records...');
    deletionResults.executionTransition = await prisma.executionTransition.deleteMany({});
    deletionResults.executionMetric = await prisma.executionMetric.deleteMany({});
    deletionResults.executionCheckpoint = await prisma.executionCheckpoint.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.executionTransition.count} ExecutionTransition records`);
    console.log(`  ✓ Deleted ${deletionResults.executionMetric.count} ExecutionMetric records`);
    console.log(`  ✓ Deleted ${deletionResults.executionCheckpoint.count} ExecutionCheckpoint records\n`);

    console.log('Layer 2: Approval decisions and performance metrics...');
    deletionResults.approvalDecision = await prisma.approvalDecision.deleteMany({});
    deletionResults.providerPerformanceMetrics = await prisma.providerPerformanceMetrics.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.approvalDecision.count} ApprovalDecision records`);
    console.log(`  ✓ Deleted ${deletionResults.providerPerformanceMetrics.count} ProviderPerformanceMetrics records\n`);

    console.log('Layer 3: Published creatives...');
    deletionResults.publishedCreative = await prisma.publishedCreative.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.publishedCreative.count} PublishedCreative records\n`);

    console.log('Layer 4: Artifact approvals and artifacts...');
    deletionResults.artifactApproval = await prisma.artifactApproval.deleteMany({});
    deletionResults.artifact = await prisma.artifact.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.artifactApproval.count} ArtifactApproval records`);
    console.log(`  ✓ Deleted ${deletionResults.artifact.count} Artifact records\n`);

    console.log('Layer 5: Execution requests...');
    deletionResults.executionRequest = await prisma.executionRequest.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.executionRequest.count} ExecutionRequest records\n`);

    console.log('Layer 6: Audit logs...');
    deletionResults.auditLog = await prisma.auditLog.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.auditLog.count} AuditLog records\n`);

    console.log('Layer 7: Campaign data...');
    deletionResults.reinforcementSnapshot = await prisma.reinforcementSnapshot.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.reinforcementSnapshot.count} ReinforcementSnapshot records\n`);

    console.log('Layer 8: OAuth tokens...');

    console.log('Layer 9: Users...');
    deletionResults.user = await prisma.user.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.user.count} User records\n`);

    console.log('Layer 10: Workspaces...');
    deletionResults.workspace = await prisma.workspace.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.workspace.count} Workspace records\n`);

    console.log('Layer 11: Independent tables...');
    deletionResults.webhookEvent = await prisma.webhookEvent.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.webhookEvent.count} WebhookEvent records\n`);

  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    throw error;
  }

  console.log('📊 Collecting post-deletion counts...\n');

  // Get counts after deletion
  afterCounts.executionTransition = await prisma.executionTransition.count();
  afterCounts.executionMetric = await prisma.executionMetric.count();
  afterCounts.executionCheckpoint = await prisma.executionCheckpoint.count();
  afterCounts.approvalDecision = await prisma.approvalDecision.count();
  afterCounts.providerPerformanceMetrics = await prisma.providerPerformanceMetrics.count();
  afterCounts.publishedCreative = await prisma.publishedCreative.count();
  afterCounts.artifactApproval = await prisma.artifactApproval.count();
  afterCounts.artifact = await prisma.artifact.count();
  afterCounts.executionRequest = await prisma.executionRequest.count();
  afterCounts.auditLog = await prisma.auditLog.count();
  afterCounts.user = await prisma.user.count();
  afterCounts.workspace = await prisma.workspace.count();
  afterCounts.webhookEvent = await prisma.webhookEvent.count();
  afterCounts.reinforcementSnapshot = await prisma.reinforcementSnapshot.count();
  afterCounts.migrations = await prisma.$queryRaw`SELECT COUNT(*) FROM "_prisma_migrations"`.then(r => Number(r[0].count));

  console.log('After deletion:');
  console.table(afterCounts);

  // Verify all user tables are empty
  const userDataRemaining = Object.entries(afterCounts)
    .filter(([key]) => key !== 'migrations')
    .some(([_, count]) => count > 0);

  if (userDataRemaining) {
    console.error('\n❌ WARNING: Some user data remains in the database!');
    console.error('   This may indicate a FK dependency issue.');
  } else {
    console.log('\n✅ All user data successfully removed from database');
  }

  console.log(`✅ Migrations preserved: ${afterCounts.migrations} records\n`);

  return { beforeCounts, afterCounts, deletionResults };
}

// ══════════════════════════════════════════════════════════════
// STEP 4: REDIS / BULLMQ QUEUE CLEANUP
// ══════════════════════════════════════════════════════════════

async function clearQueues() {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│             QUEUE CLEANUP                               │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  if (!process.env.REDIS_URL) {
    console.log('⚠️  REDIS_URL not set — skipping queue cleanup\n');
    return {};
  }

  const queueNames = ['actions', 'observer', 'campaign-sync', 'executions'];
  const queuePrefix = 'marcom';
  const queueResults = {};

  console.log('🗑️  Clearing BullMQ queues...\n');

  for (const queueName of queueNames) {
    try {
      const queue = new Queue(queueName, {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
        },
        prefix: queuePrefix,
      });

      // Get job counts before clearing
      const counts = await queue.getJobCounts();
      const totalBefore = Object.values(counts).reduce((sum, count) => sum + count, 0);

      // Obliterate the queue (removes all jobs in all states)
      await queue.obliterate({ force: true });

      queueResults[queueName] = {
        before: totalBefore,
        after: 0,
        removed: totalBefore,
      };

      console.log(`  ✓ Cleared ${queueName}: ${totalBefore} jobs removed`);

      await queue.close();
    } catch (error) {
      console.error(`  ❌ Failed to clear ${queueName}:`, error.message);
      queueResults[queueName] = { error: error.message };
    }
  }

  console.log('\n✅ Queue cleanup complete\n');

  return queueResults;
}

// ══════════════════════════════════════════════════════════════
// STEP 5: FIREBASE AUTH CLEANUP
// ══════════════════════════════════════════════════════════════

async function clearFirebaseAuth() {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│         FIREBASE AUTH CLEANUP                           │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  let totalDeleted = 0;
  let pageToken;

  console.log('🗑️  Deleting Firebase users...\n');

  try {
    do {
      const listResult = await admin.auth().listUsers(1000, pageToken);
      const uids = listResult.users.map(u => u.uid);

      if (uids.length > 0) {
        console.log(`  Deleting batch of ${uids.length} users...`);
        const deleteResult = await admin.auth().deleteUsers(uids);
        totalDeleted += deleteResult.successCount;

        if (deleteResult.failureCount > 0) {
          console.error(`  ⚠️  Failed to delete ${deleteResult.failureCount} users:`);
          deleteResult.errors.forEach(err => {
            console.error(`     - UID ${err.index}: ${err.error.message}`);
          });
        }
      }

      pageToken = listResult.pageToken;
    } while (pageToken);

    console.log(`\n✅ Firebase Auth cleanup complete: ${totalDeleted} users deleted\n`);
  } catch (error) {
    console.error('❌ Firebase Auth cleanup failed:', error);
    throw error;
  }

  return { totalDeleted };
}

// ══════════════════════════════════════════════════════════════
// STEP 6: POST-RESET VERIFICATION
// ══════════════════════════════════════════════════════════════

async function verifyReset() {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│         POST-RESET VERIFICATION                         │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  console.log('🔍 Verifying database state...\n');

  const finalCounts = {
    executionTransition: await prisma.executionTransition.count(),
    executionMetric: await prisma.executionMetric.count(),
    executionCheckpoint: await prisma.executionCheckpoint.count(),
    approvalDecision: await prisma.approvalDecision.count(),
    providerPerformanceMetrics: await prisma.providerPerformanceMetrics.count(),
    publishedCreative: await prisma.publishedCreative.count(),
    artifactApproval: await prisma.artifactApproval.count(),
    artifact: await prisma.artifact.count(),
    executionRequest: await prisma.executionRequest.count(),
    auditLog: await prisma.auditLog.count(),
    user: await prisma.user.count(),
    workspace: await prisma.workspace.count(),
    webhookEvent: await prisma.webhookEvent.count(),
    reinforcementSnapshot: await prisma.reinforcementSnapshot.count(),
    migrations: await prisma.$queryRaw`SELECT COUNT(*) FROM "_prisma_migrations"`.then(r => Number(r[0].count)),
  };

  console.table(finalCounts);

  const allZero = Object.entries(finalCounts)
    .filter(([key]) => key !== 'migrations')
    .every(([_, count]) => count === 0);

  if (allZero) {
    console.log('✅ All user data tables are empty\n');
  } else {
    console.error('❌ Some tables still contain data!\n');
  }

  console.log('🔍 Verifying Firebase state...\n');

  try {
    const listResult = await admin.auth().listUsers(1);
    console.log(`   Firebase users remaining: ${listResult.users.length}`);

    if (listResult.users.length === 0) {
      console.log('✅ Firebase Auth is empty\n');
    } else {
      console.error('❌ Firebase still has users!\n');
    }
  } catch (error) {
    console.error('❌ Failed to verify Firebase state:', error.message);
  }

  return finalCounts;
}

// ══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ══════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  try {
    // Step 0: Safety checks and confirmation
    await runSafetyChecks();

    // Step 1-3: Database cleanup
    const dbResults = await clearDatabase();

    // Step 4: Queue cleanup
    const queueResults = await clearQueues();

    // Step 5: Firebase cleanup
    const firebaseResults = await clearFirebaseAuth();

    // Step 6: Verification
    const finalCounts = await verifyReset();

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│         RESET COMPLETE                                  │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    console.log(`✅ Data reset completed in ${duration}s\n`);

    console.log('📋 Summary:\n');
    console.log(`   Database records deleted: ${Object.values(dbResults.deletionResults).reduce((sum, r) => sum + r.count, 0)}`);
    console.log(`   Firebase users deleted: ${firebaseResults.totalDeleted}`);
    console.log(`   Queue jobs removed: ${Object.values(queueResults).reduce((sum, r) => sum + (r.removed || 0), 0)}\n`);

    console.log('⚠️  IMPORTANT NEXT STEPS:\n');
    console.log('   1. RESTART the backend server to clear in-memory caches');
    console.log('      - workspaceCache in firebaseAuth.js');
    console.log('      - Any other in-memory state\n');
    console.log('   2. Test the onboarding flow:');
    console.log('      - Open app in incognito window');
    console.log('      - Sign up with new email');
    console.log('      - Verify redirect to /onboarding');
    console.log('      - Complete wizard');
    console.log('      - Verify redirect to /app/home\n');
    console.log('   3. Verify context API:');
    console.log('      - GET /api/campaigns/me/context returns valid context');
    console.log('      - Unauthenticated request returns 400\n');

  } catch (error) {
    console.error('\n❌ Reset failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Run the script
main();
