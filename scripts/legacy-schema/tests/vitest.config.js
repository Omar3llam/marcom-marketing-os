import { defineConfig } from 'vitest/config';
// Dedicated native fixtures: no application globalSetup or migration76 execution.
// This is NOT test:full. The existing network guard remains installed.
export default defineConfig({test:{environment:'node',setupFiles:['./src/tests/networkGuard.js'],
  include:['scripts/legacy-schema/tests/validator.test.js'],pool:'forks',maxWorkers:1,testTimeout:10000,hookTimeout:20000}});
