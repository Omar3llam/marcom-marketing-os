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
  },
});
