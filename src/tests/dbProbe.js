// ============================================================
// dbProbe — "is a usable database reachable?" for integration tests
// ============================================================
// Some backend suites are genuine DB-integration tests (they create/clean
// real rows). When no database is configured — or the configured one is
// behind on migrations — those suites should SKIP, not hard-fail, so the
// unit suite stays green locally while the integration suites still run in
// full against a migrated DB (CI).
//
// Usage (top-level await is supported in vitest test files):
//   import { dbAvailable } from '../../tests/dbProbe.js';
//   const DB_OK = await dbAvailable();
//   describe.skipIf(!DB_OK)('my integration suite', () => { ... });
//
// The probe touches a recent column so a STALE schema reads as "not
// available" too (a partially-migrated DB would otherwise fail mid-suite).
// ============================================================
import { PrismaClient } from '@prisma/client';

let cached;

export async function dbAvailable() {
  if (cached !== undefined) return cached;
  const prisma = new PrismaClient();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 4000));
  try {
    const probe = prisma.workspace
      .findFirst({ select: { id: true, networkConsent: true } })
      .then(() => true)
      .catch(() => false);
    cached = await Promise.race([probe, timeout]);
  } catch {
    cached = false;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  if (!cached) {
    console.warn('[dbProbe] no migrated database reachable — DB integration suites will skip.');
  }
  return cached;
}
