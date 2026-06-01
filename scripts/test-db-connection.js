// Quick script to test PostgreSQL connection with different credentials
import { PrismaClient } from '@prisma/client';

const commonCredentials = [
  'postgresql://postgres:postgres@localhost:5432/marcom',
  'postgresql://postgres:password@localhost:5432/marcom',
  'postgresql://postgres:admin@localhost:5432/marcom',
  'postgresql://postgres@localhost:5432/marcom', // No password
  'postgresql://marcom:marcom@localhost:5432/marcom',
  'postgresql://user:user@localhost:5432/marcom',
];

async function testConnection(url) {
  const maskedUrl = url.replace(/:([^:@]+)@/, ':***@');
  process.env.DATABASE_URL = url;

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log(`✅ SUCCESS: ${maskedUrl}`);
    await prisma.$disconnect();
    return true;
  } catch (error) {
    console.log(`❌ FAILED: ${maskedUrl} — ${error.message.split('\n')[0]}`);
    await prisma.$disconnect();
    return false;
  }
}

async function main() {
  console.log('Testing PostgreSQL connection with common credentials...\n');

  for (const url of commonCredentials) {
    const success = await testConnection(url);
    if (success) {
      console.log('\n🎉 Found working credentials! Update your .env file with:');
      console.log(`DATABASE_URL=${url}\n`);
      process.exit(0);
    }
  }

  console.log('\n❌ None of the common credentials worked.');
  console.log('Please check your PostgreSQL installation and provide the correct credentials.\n');
  process.exit(1);
}

main();
