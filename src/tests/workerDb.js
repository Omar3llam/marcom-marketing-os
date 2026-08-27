// ============================================================
// workerDb — bind this worker to its own database (B5-01H)
// ============================================================
// A vitest `setupFiles` module. It runs inside each worker BEFORE the worker
// imports any test file, which is the only window that works: src/lib/prisma.js
// constructs its PrismaClient at module-import time, so DATABASE_URL has to be
// correct before the first import of it — not before the first query.
//
// Full verification only. In fast mode this is a no-op and the ambient
// environment is left exactly as it was.
//
// FAIL CLOSED (§21). If this worker has no provisioned database, the run stops
// here. It must not fall back to the ambient database, and it must not let the
// DB suites skip — a silent skip under REQUIRE_DB is the precise failure
// B5-01G closed, and reaching it through a missing worker database would be the
// same lie wearing a different hat.
// ============================================================
import { IsolationSetupError, workerName, urlForDatabase } from './dbIsolation.js';

if (process.env.REQUIRE_DB === '1') {
  const root = process.env.LUMI_TEST_DB_ROOT;
  const poolId = process.env.VITEST_POOL_ID;

  if (!root) {
    throw new IsolationSetupError(
      'REQUIRE_DB=1 but no isolated databases were provisioned (LUMI_TEST_DB_ROOT is unset).\n'
      + '  globalSetup did not run, or did not complete. Refusing to fall back to the ambient database.',
    );
  }
  if (!poolId) {
    throw new IsolationSetupError('VITEST_POOL_ID is unset — cannot identify which worker database to use.');
  }

  // The base URL supplies host/credentials; only the database name changes.
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new IsolationSetupError('TEST_DATABASE_URL is unset inside the worker.');

  const url = urlForDatabase(base, workerName(root, poolId));

  // Both, because Prisma reads DATABASE_URL for queries and DIRECT_URL is
  // declared in the datasource block; leaving DIRECT_URL pointed elsewhere
  // would give one client two different databases.
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;

  // Readable by tests that need to prove which database they are on, without
  // any test ever handling a connection string.
  process.env.LUMI_TEST_DB_NAME = workerName(root, poolId);
}
