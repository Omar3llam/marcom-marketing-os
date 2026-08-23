// MARCOM Reset — NO CONFIRMATION (use with caution!)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🗑️  Resetting MARCOM database...\n');

  try {
    // Delete in FK dependency order
    console.log('Deleting execution lifecycle...');
    await prisma.executionTransition.deleteMany({});
    await prisma.executionMetric.deleteMany({});
    await prisma.executionCheckpoint.deleteMany({});

    console.log('Deleting approvals...');
    await prisma.approvalDecision.deleteMany({});
    await prisma.providerPerformanceMetrics.deleteMany({});

    console.log('Deleting creatives...');
    await prisma.publishedCreative.deleteMany({});

    console.log('Deleting artifacts...');
    await prisma.artifactApproval.deleteMany({});
    await prisma.artifact.deleteMany({});

    console.log('Deleting execution requests...');
    await prisma.executionRequest.deleteMany({});

    console.log('Deleting audit & actions...');
    await prisma.auditLog.deleteMany({});

    console.log('Deleting campaign data...');
    await prisma.reinforcementSnapshot.deleteMany({});

    console.log('Deleting auth data...');
    await prisma.oAuthToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.workspace.deleteMany({});

    console.log('Deleting webhooks...');
    await prisma.webhookEvent.deleteMany({});

    // Verify
    const counts = {
      user: await prisma.user.count(),
      workspace: await prisma.workspace.count(),
      executionRequest: await prisma.executionRequest.count(),
    };

    console.log('\n✅ Reset complete!');
    console.table(counts);

  } catch (error) {
    console.error('\n❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
