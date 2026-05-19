// ============================================================
// MARCOM v4.1 — MSW Server Setup
// ------------------------------------------------------------
// Mock Service Worker server for intercepting API requests.
//
// USAGE:
//   import { server } from '@/tests/mocks/server';
//   beforeAll(() => server.listen());
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
// ============================================================

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW Server — Intercepts API requests in Node.js (tests).
 */
export const server = setupServer(...handlers);
