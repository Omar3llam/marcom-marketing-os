// ============================================================
// MARCOM v4.1 — Vitest Configuration
// ------------------------------------------------------------
// Unit testing configuration for React components and hooks.
//
// USAGE:
//   npm run test         — Run all tests
//   npm run test:watch   — Run tests in watch mode
//   npm run test:ui      — Open vitest UI
//   npm run test:coverage — Generate coverage report
// ============================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
      'src/tests/userAgentDetection.test.js',
    ],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx,js,jsx}',
        'src/**/*.spec.{ts,tsx,js,jsx}',
        'src/tests/**',
        'src/main.jsx',
        'src/vite-env.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
