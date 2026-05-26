// Temporary debug script to check workspace for user
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userId = 'hsDYfwGTrhUiPRHhv3AAAfUUI7B2'; // From your JWT

async function checkWorkspace() {
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: {
        id: true,
        email: true,
        clerkId: true,
        workspaceId: true,
        role: true,
        context: true,
        createdAt: true,
      },
    });

    console.log('User record:', JSON.stringify(user, null, 2));

    if (user?.workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: user.workspaceId },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      });
      console.log('Workspace record:', JSON.stringify(workspace, null, 2));
    } else {
      console.log('❌ User has no workspaceId');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkWorkspace();
