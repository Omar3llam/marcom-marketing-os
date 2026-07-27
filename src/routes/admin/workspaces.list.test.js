// ============================================================
// Admin — GET /api/admin/workspaces (search + pagination)
// ------------------------------------------------------------
// The defect this route existed with: `total: workspaces.length` reported the
// length of an already-capped page, so an install with 250 workspaces was told
// it had 100. Every "total" assertion here exists to keep that from returning.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    loopRun: { findMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/connectors/credentialStore.js', () => ({ listConnections: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { workspacesRouter } from './workspaces.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'admin-uid'; req.user = { email: 'a@b.co' }; next(); });
  app.use('/api/admin/workspaces', workspacesRouter);
  return app;
}

const row = (over = {}) => ({
  id: 'w1', name: 'Acme', currency: 'EGP', plan: 'FREE',
  createdAt: new Date('2026-01-01'), _count: { users: 3, decisions: 12 }, ...over,
});

/** The findMany arg of the most recent list call. */
const lastFind = () => prisma.workspace.findMany.mock.calls.at(-1)[0];
const lastCount = () => prisma.workspace.count.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findMany.mockResolvedValue([row()]);
  prisma.workspace.count.mockResolvedValue(1);
});

describe('GET /workspaces — the honest total', () => {
  it('reports the real count, not the page length', async () => {
    prisma.workspace.count.mockResolvedValue(312);
    prisma.workspace.findMany.mockResolvedValue([row(), row({ id: 'w2' })]);

    const res = await request(makeApp()).get('/api/admin/workspaces').expect(200);

    expect(res.body.total).toBe(312);
    expect(res.body.workspaces).toHaveLength(2);
  });

  it('counts under the SAME where clause as the page', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=acme').expect(200);
    expect(lastCount().where).toEqual(lastFind().where);
  });

  it('echoes the limit and offset it actually applied', async () => {
    const res = await request(makeApp()).get('/api/admin/workspaces?limit=10&offset=20').expect(200);
    expect(res.body).toMatchObject({ limit: 10, offset: 20 });
  });
});

describe('GET /workspaces — search and filters', () => {
  it('q → a case-insensitive contains on name', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=acme').expect(200);
    expect(lastFind().where).toEqual({ AND: [{ name: { contains: 'acme', mode: 'insensitive' } }] });
  });

  it('trims a whitespace-padded q', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=%20%20acme%20%20').expect(200);
    expect(lastFind().where.AND[0].name.contains).toBe('acme');
  });

  it('a whitespace-only q is no filter at all', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=%20%20%20').expect(200);
    expect(lastFind().where).toEqual({});
  });

  it('plan → an exact match', async () => {
    await request(makeApp()).get('/api/admin/workspaces?plan=PRO').expect(200);
    expect(lastFind().where).toEqual({ AND: [{ plan: 'PRO' }] });
  });

  // Workspace.plan is a plain String, so an unrecognised value would not throw —
  // it would silently return zero rows and read as "no PRO workspaces exist".
  it('ignores a plan that is not a real entitlement', async () => {
    await request(makeApp()).get('/api/admin/workspaces?plan=ENTERPRISE').expect(200);
    expect(lastFind().where).toEqual({});
  });

  it('demo=true → the name sentinel', async () => {
    await request(makeApp()).get('/api/admin/workspaces?demo=true').expect(200);
    expect(lastFind().where).toEqual({ AND: [{ name: { startsWith: 'Demo —' } }] });
  });

  it('demo=false → NOT the name sentinel', async () => {
    await request(makeApp()).get('/api/admin/workspaces?demo=false').expect(200);
    expect(lastFind().where).toEqual({ AND: [{ NOT: { name: { startsWith: 'Demo —' } } }] });
  });

  // Both q and demo constrain `name`. Composed by object spread, one silently
  // overwrites the other and the operator's search term vanishes.
  it('q and demo compose — neither clobbers the other', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=acme&demo=true').expect(200);
    expect(lastFind().where).toEqual({
      AND: [
        { name: { contains: 'acme', mode: 'insensitive' } },
        { name: { startsWith: 'Demo —' } },
      ],
    });
  });

  it('all three filters compose', async () => {
    await request(makeApp()).get('/api/admin/workspaces?q=acme&plan=PRO&demo=false').expect(200);
    expect(lastFind().where.AND).toHaveLength(3);
  });

  it('no filters → no where clause', async () => {
    await request(makeApp()).get('/api/admin/workspaces').expect(200);
    expect(lastFind().where).toEqual({});
  });
});

describe('GET /workspaces — pagination guards', () => {
  it('defaults to 25 per page', async () => {
    await request(makeApp()).get('/api/admin/workspaces').expect(200);
    expect(lastFind()).toMatchObject({ take: 25, skip: 0 });
  });

  it('respects limit and offset', async () => {
    await request(makeApp()).get('/api/admin/workspaces?limit=10&offset=30').expect(200);
    expect(lastFind()).toMatchObject({ take: 10, skip: 30 });
  });

  it('caps limit at the configured maximum', async () => {
    await request(makeApp()).get('/api/admin/workspaces?limit=5000').expect(200);
    expect(lastFind().take).toBe(100);
  });

  // take: NaN throws in Prisma — a junk limit must never reach it.
  it('a non-numeric limit falls back to the default', async () => {
    await request(makeApp()).get('/api/admin/workspaces?limit=abc').expect(200);
    expect(lastFind().take).toBe(25);
    expect(Number.isNaN(lastFind().take)).toBe(false);
  });

  it('a negative offset clamps to 0', async () => {
    await request(makeApp()).get('/api/admin/workspaces?offset=-10').expect(200);
    expect(lastFind().skip).toBe(0);
  });
});

describe('GET /workspaces — shape and failure', () => {
  it('still maps counts and the demo sentinel', async () => {
    prisma.workspace.findMany.mockResolvedValue([
      row({ name: 'Maison Salam' }),
      row({ id: 'w2', name: 'Demo — Maison Salam · 2026' }),
    ]);
    const res = await request(makeApp()).get('/api/admin/workspaces').expect(200);

    expect(res.body.workspaces[0]).toMatchObject({ userCount: 3, decisionCount: 12, isDemo: false });
    expect(res.body.workspaces[1]).toMatchObject({ isDemo: true });
  });

  it('returns { error } — never a trace — when the count fails', async () => {
    prisma.workspace.count.mockRejectedValue(new Error('connection refused'));
    const res = await request(makeApp()).get('/api/admin/workspaces').expect(500);
    expect(res.body).toEqual({ error: 'Failed to list workspaces' });
  });
});
