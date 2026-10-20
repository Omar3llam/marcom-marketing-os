// ============================================================
// MARCOM / Lumi — Prisma Client Singleton
// ------------------------------------------------------------
// Re-using a single PrismaClient across the process avoids
// exhausting Postgres connections under hot-reload (`--watch`)
// and inside BullMQ workers that share the same Node runtime.
// ============================================================
import { PrismaClient } from '@prisma/client';

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

// Constructing a PrismaClient does not open a connection. The first explicit
// request/job query establishes the connection lazily through Prisma.
// Do not add $connect() at module import: admission must be proven before
// any deliberate DB connection or worker side effect.
// This source-only boundary does NOT implement runtime admission.
