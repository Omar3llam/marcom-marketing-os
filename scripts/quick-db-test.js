import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$connect();
  console.log('✅ Database connection successful!');
  const result = await prisma.$queryRaw`SELECT current_database(), current_user`;
  console.log('Connected to:', result[0]);
  await prisma.$disconnect();
} catch (error) {
  console.error('❌ Connection failed:', error.message);
  process.exit(1);
}
