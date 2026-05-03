// ============================================================
// MARCOM / Lumi — Prisma Client Singleton
// ------------------------------------------------------------
// Re-using a single PrismaClient across the process avoids
// exhausting Postgres connections under hot-reload (`--watch`)
// and inside BullMQ workers that share the same Node runtime.
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger }       from '../utils/logger.js';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__lumi_prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['warn', 'error']
      : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__lumi_prisma = prisma;
}

prisma.$connect()
  .then(() => logger.info('[prisma] connected'))
  .catch((err) => logger.warn({ err: err.message }, '[prisma] connect deferred — DB unreachable at boot'));
