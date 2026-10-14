import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { assertVerificationRuntime } from './scripts/runtimeContract.js';

assertVerificationRuntime(process.version, 'npm run test:legacy-contracts');
if (!existsSync('client/src')) throw new Error('Legacy contract verification requires client/src');

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/tests/networkGuard.js'],
    include: ['tests/legacy-frontend/**/*.test.js'],
    pool: 'forks',
    maxWorkers: 4,
  },
});
