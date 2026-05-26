// Fix script: Create workspace and link to user
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userId = 'hsDYfwGTrhUiPRHhv3AAAfUUI7B2';
const userEmail = 'omar3llam.oa@gmail.com';
const userName = 'Omar Allam';

async function fixWorkspace() {
  try {
    console.log('🔍 Checking user...');
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, email: true, workspaceId: true },
    });

    if (!user) {
      console.error('❌ User not found');
      process.exit(1);
    }

    console.log('✓ User found:', user.email);

    if (user.workspaceId) {
      console.log('✓ User already has workspace:', user.workspaceId);
      process.exit(0);
    }

    console.log('📦 Creating workspace...');
    const workspace = await prisma.workspace.create({
      data: {
        name: `${userName}'s Workspace`,
      },
    });

    console.log('✓ Workspace created:', workspace.id);

    console.log('🔗 Linking user to workspace...');
    await prisma.user.update({
      where: { clerkId: userId },
      data: { workspaceId: workspace.id },
    });

    console.log('✅ Fix complete!');
    console.log('   User:', user.email);
    console.log('   Workspace:', workspace.id);
    console.log('\n🎯 You can now upload CSV files');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixWorkspace();
