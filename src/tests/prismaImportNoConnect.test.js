// 03B-4: importing the Prisma singleton must not open a database connection.
// This test isolates the Prisma constructor and records connection/query calls;
// full backend DB verification separately confirms first-query behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ constructed: 0, connected: 0, queried: 0 }));
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      calls.constructed += 1;
      this.workspace = {
        findUnique: async () => {
          calls.queried += 1;
          return { plan: 'STARTER' };
        },
      };
    }
    async $connect() {
      calls.connected += 1;
    }
  },
}));

let previous;
beforeEach(() => {
  previous = globalThis.__lumi_prisma;
  delete globalThis.__lumi_prisma;
  calls.constructed = 0;
  calls.connected = 0;
  calls.queried = 0;
  vi.resetModules();
});
afterEach(() => {
  if (previous === undefined) delete globalThis.__lumi_prisma;
  else globalThis.__lumi_prisma = previous;
  vi.resetModules();
});

describe('03B-4 Prisma singleton import boundary', () => {
  it('constructs the singleton without connecting or querying at import', async () => {
    const { prisma } = await import('../lib/prisma.js');
    expect(prisma).toBeTruthy();
    expect(calls.constructed).toBe(1);
    expect(calls.connected).toBe(0);
    expect(calls.queried).toBe(0);
  });

  it('reuses the singleton without eager connect and still exposes request-time queries', async () => {
    const first = (await import('../lib/prisma.js')).prisma;
    vi.resetModules();
    const second = (await import('../lib/prisma.js')).prisma;
    expect(second).toBe(first);
    expect(calls.constructed).toBe(1);
    expect(calls.connected).toBe(0);
    const result = await second.workspace.findUnique({ where: { id: 'synthetic-workspace' } });
    expect(result).toEqual({ plan: 'STARTER' });
    expect(calls.queried).toBe(1);
    expect(calls.connected).toBe(0);
  });
});
