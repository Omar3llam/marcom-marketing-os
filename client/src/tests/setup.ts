// ============================================================
// MARCOM v4.1 — Test Setup
// ------------------------------------------------------------
// Global test configuration for vitest + @testing-library/react.
//
// Loaded automatically before all tests via vitest.config.ts.
// ============================================================

import { expect, afterEach, afterAll, vi, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend vitest's expect with @testing-library/jest-dom matchers
expect.extend(matchers);

// Cleanup after each test (unmount React components)
afterEach(() => {
  cleanup();
});

// Setup MSW server
import { server } from './mocks/server';
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Mock Firebase auth
vi.mock('@/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
      email: 'test@example.com',
      uid: 'test-uid',
    },
  },
}));

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock window.matchMedia (not implemented in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock IntersectionObserver (not implemented in jsdom)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
} as any;
