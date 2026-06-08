// ============================================================
// Vitest Configuration — Backend Tests
// ============================================================
// Loads .env before running tests to avoid config errors.
// ============================================================
import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
dotenvConfig({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
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
