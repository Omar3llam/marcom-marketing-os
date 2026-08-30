// ============================================================
// Vitest Configuration — Backend Tests
// ============================================================
// Loads .env before running tests to avoid config errors.
// ============================================================
import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { MAX_WORKERS } from './src/tests/dbIsolation.js';

// Load .env from project root
dotenvConfig({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // B5-01H. Full verification (REQUIRE_DB=1) gives every worker its OWN
    // PostgreSQL database, so two suites cannot mutate each other's rows.
    // globalSetup provisions them; setupFiles binds each worker to one. Both
    // are no-ops in fast mode. See src/tests/dbIsolation.js.
    globalSetup: ['./src/tests/globalSetup.js'],
    // B5-01P″′ — networkGuard is FIRST on purpose. It sets CHECKPOINT_DISABLE
    // before any Prisma client can be constructed, and it must be installed
    // before a suite gets the chance to open a socket. See src/tests/networkGuard.js.
    setupFiles: ['./src/tests/networkGuard.js', './src/tests/workerDb.js'],
    // Pinned so the provisioner and the pool agree on the worker count: a
    // worker whose database was never created must not be able to exist. This
    // is the pool's normal width, NOT a serialisation — isolation is the fix
    // for STOP-4, and hiding the race behind a single worker would not be.
    //
    // Top-level, not `poolOptions`: Vitest 4 REMOVED `test.poolOptions`, and it
    // is accepted-then-ignored rather than rejected, so the first version of
    // this pinned nothing at all and only a deprecation line in the output said
    // so. See vitest.dev/guide/migration#pool-rework.
    pool: 'forks',
    maxWorkers: MAX_WORKERS,
    minWorkers: 1,
    // Backend suite ONLY. The client has its own jsdom config
    // (client/vitest.config.ts, run via `cd client && npm test`); sweeping
    // its React/jsdom tests + the Playwright e2e specs into this node pool
    // crashes workers and poisons the run. Scope this runner to backend code.
    include: [
      'src/**/*.test.js',
      'packages/**/*.test.js',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'client/**',
      'design-system-figma/**',
      '**/*.spec.cjs', // Playwright e2e — run via @playwright/test, not vitest
      'src/tests/dialect.test.js', // standalone node script (run via `node`), not a vitest suite
    ],
  },
});
