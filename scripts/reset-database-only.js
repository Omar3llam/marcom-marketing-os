// ============================================================
// MARCOM v4.1 — Database-Only Reset Script
// ============================================================
// PURPOSE: Reset database to clean state (skips Firebase Auth)
// USAGE: node scripts/reset-database-only.js
// ============================================================

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import readline from 'readline';

const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════
// STEP 0: SAFETY CHECKS
// ══════════════════════════════════════════════════════════════

async function runSafetyChecks() {
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│    MARCOM DATABASE RESET — SAFETY CHECK                │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  console.log('🔍 Checking database connection...\n');
  try {
    const dbInfo = await prisma.$queryRaw`
      SELECT
        current_database() as database,
        current_user as "user",
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

  const databaseUrl = process.env.DATABASE_URL || '';
  const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@');
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
    console.error('   Exiting immediately to prevent data loss.\n');
    process.exit(1);
  }

  console.log('✅ Database URL safety check passed\n');

  console.log('📋 Tables that will be CLEARED:\n');
  const tablesToClear = [
    'ExecutionTransition',
    'ExecutionMetric',
    'ExecutionCheckpoint',
    'ApprovalDecision',
    'ProviderPerformanceMetrics',
    'PublishedCreative',
    'ArtifactApproval',
    'Artifact',
    'DecisionMemory',
    'ExecutionRequest',
    'AuditLog',
    'Action',
    'CampaignState',
    'Integration',
    'OAuthToken',
    'User',
    'Workspace',
    'WebhookEvent',
    'ReinforcementSnapshot',
  ];
  tablesToClear.forEach((table, i) => {
    console.log(`   ${i + 1}. ${table}`);
  });

  console.log('\n⚠️  WARNING: This operation is IRREVERSIBLE!\n');

  const confirmed = await getUserConfirmation();
  if (!confirmed) {
    console.log('\n❌ Operation cancelled by user.\n');
    process.exit(0);
  }

  console.log('\n✅ Confirmation received. Proceeding with reset...\n');
}

async function getUserConfirmation() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Type exactly "RESET MARCOM DATA" to continue: ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'RESET MARCOM DATA');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// DATABASE CLEANUP
// ══════════════════════════════════════════════════════════════

async function clearDatabase() {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│             DATABASE CLEANUP                            │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const beforeCounts = {};
  const deletionResults = {};

  console.log('📊 Collecting pre-deletion counts...\n');

  beforeCounts.executionTransition = await prisma.executionTransition.count();
  beforeCounts.executionMetric = await prisma.executionMetric.count();
  beforeCounts.executionCheckpoint = await prisma.executionCheckpoint.count();
  beforeCounts.approvalDecision = await prisma.approvalDecision.count();
  beforeCounts.providerPerformanceMetrics = await prisma.providerPerformanceMetrics.count();
  beforeCounts.publishedCreative = await prisma.publishedCreative.count();
  beforeCounts.artifactApproval = await prisma.artifactApproval.count();
  beforeCounts.artifact = await prisma.artifact.count();
  beforeCounts.decisionMemory = await prisma.decisionMemory.count();
  beforeCounts.executionRequest = await prisma.executionRequest.count();
  beforeCounts.auditLog = await prisma.auditLog.count();
  beforeCounts.action = await prisma.action.count();
  beforeCounts.campaignState = await prisma.campaignState.count();
  beforeCounts.oauthToken = await prisma.oAuthToken.count();
  beforeCounts.user = await prisma.user.count();
  beforeCounts.workspace = await prisma.workspace.count();
  beforeCounts.webhookEvent = await prisma.webhookEvent.count();
  beforeCounts.reinforcementSnapshot = await prisma.reinforcementSnapshot.count();

  console.log('Before deletion:');
  console.table(beforeCounts);

  console.log('\n🗑️  Deleting in FK dependency order...\n');

  try {
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

    console.log('Layer 5: Decision memory and execution requests...');
    deletionResults.decisionMemory = await prisma.decisionMemory.deleteMany({});
    deletionResults.executionRequest = await prisma.executionRequest.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.decisionMemory.count} DecisionMemory records`);
    console.log(`  ✓ Deleted ${deletionResults.executionRequest.count} ExecutionRequest records\n`);

    console.log('Layer 6: Audit logs and actions...');
    deletionResults.auditLog = await prisma.auditLog.deleteMany({});
    deletionResults.action = await prisma.action.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.auditLog.count} AuditLog records`);
    console.log(`  ✓ Deleted ${deletionResults.action.count} Action records\n`);

    console.log('Layer 7: Campaign data...');
    deletionResults.campaignState = await prisma.campaignState.deleteMany({});
    deletionResults.reinforcementSnapshot = await prisma.reinforcementSnapshot.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.campaignState.count} CampaignState records`);
    console.log(`  ✓ Deleted ${deletionResults.reinforcementSnapshot.count} ReinforcementSnapshot records\n`);

    console.log('Layer 8: OAuth tokens...');
    deletionResults.oauthToken = await prisma.oAuthToken.deleteMany({});
    console.log(`  ✓ Deleted ${deletionResults.oauthToken.count} OAuthToken records\n`);

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

  console.log('📊 Verifying deletion...\n');

  const afterCounts = {
    executionTransition: await prisma.executionTransition.count(),
    executionMetric: await prisma.executionMetric.count(),
    executionCheckpoint: await prisma.executionCheckpoint.count(),
    approvalDecision: await prisma.approvalDecision.count(),
    providerPerformanceMetrics: await prisma.providerPerformanceMetrics.count(),
    publishedCreative: await prisma.publishedCreative.count(),
    artifactApproval: await prisma.artifactApproval.count(),
    artifact: await prisma.artifact.count(),
    decisionMemory: await prisma.decisionMemory.count(),
    executionRequest: await prisma.executionRequest.count(),
    auditLog: await prisma.auditLog.count(),
    action: await prisma.action.count(),
    campaignState: await prisma.campaignState.count(),
    oauthToken: await prisma.oAuthToken.count(),
    user: await prisma.user.count(),
    workspace: await prisma.workspace.count(),
    webhookEvent: await prisma.webhookEvent.count(),
    reinforcementSnapshot: await prisma.reinforcementSnapshot.count(),
  };

  console.log('After deletion:');
  console.table(afterCounts);

  const allZero = Object.values(afterCounts).every(count => count === 0);

  if (allZero) {
    console.log('\n✅ All user data successfully removed from database\n');
  } else {
    console.error('\n❌ WARNING: Some data remains!\n');
  }

  return { beforeCounts, afterCounts, deletionResults };
}

// ══════════════════════════════════════════════════════════════
// QUEUE CLEANUP
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

      const counts = await queue.getJobCounts();
      const totalBefore = Object.values(counts).reduce((sum, count) => sum + count, 0);

      await queue.obliterate({ force: true });

      queueResults[queueName] = { removed: totalBefore };
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
// MAIN
// ══════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  try {
    await runSafetyChecks();
    const dbResults = await clearDatabase();
    const queueResults = await clearQueues();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│         RESET COMPLETE                                  │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    console.log(`✅ Database reset completed in ${duration}s\n`);

    console.log('📋 Summary:\n');
    console.log(`   Database records deleted: ${Object.values(dbResults.deletionResults).reduce((sum, r) => sum + r.count, 0)}`);
    console.log(`   Queue jobs removed: ${Object.values(queueResults).reduce((sum, r) => sum + (r.removed || 0), 0)}\n`);

    console.log('⚠️  NEXT STEPS:\n');
    console.log('   1. Restart backend server (clear in-memory caches)');
    console.log('   2. Manually delete Firebase Auth users (if needed)');
    console.log('   3. Test onboarding flow in incognito window\n');

  } catch (error) {
    console.error('\n❌ Reset failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
