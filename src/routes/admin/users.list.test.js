// ============================================================
// Admin — GET /api/admin/users (search + pagination)
// ------------------------------------------------------------
// The role filter used to run in the browser over a capped page: selecting
// ADMIN when the only admin sat past row 200 produced "No users match this
// filter" — a false negative stated as a fact. It is a server filter now, and
// `total` is a real count rather than the page length.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { usersRouter } from './users.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'admin-uid'; req.user = { email: 'a@b.co' }; next(); });
  app.use('/api/admin/users', usersRouter);
  return app;
}

const row = (over = {}) => ({
  id: 'u1', email: 'a@acme.co', role: 'VIEWER', collabRole: 'STRATEGIST',
  createdAt: new Date('2026-01-01'), workspace: { id: 'w1', name: 'Acme' }, ...over,
});

const lastFind = () => prisma.user.findMany.mock.calls.at(-1)[0];
const lastCount = () => prisma.user.count.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findMany.mockResolvedValue([row()]);
  prisma.user.count.mockResolvedValue(1);
});

describe('GET /users — the honest total', () => {
  it('reports the real count, not the page length', async () => {
    prisma.user.count.mockResolvedValue(847);
    prisma.user.findMany.mockResolvedValue([row(), row({ id: 'u2' })]);

    const res = await request(makeApp()).get('/api/admin/users').expect(200);

    expect(res.body.total).toBe(847);
    expect(res.body.users).toHaveLength(2);
  });

  it('counts under the SAME where clause as the page', async () => {
    await request(makeApp()).get('/api/admin/users?role=ADMIN').expect(200);
    expect(lastCount().where).toEqual(lastFind().where);
  });

  it('echoes the limit and offset it actually applied', async () => {
    const res = await request(makeApp()).get('/api/admin/users?limit=10&offset=20').expect(200);
    expect(res.body).toMatchObject({ limit: 10, offset: 20 });
  });
});

describe('GET /users — search and role filter', () => {
  it('q → a case-insensitive contains on email', async () => {
    await request(makeApp()).get('/api/admin/users?q=acme').expect(200);
    expect(lastFind().where).toEqual({ email: { contains: 'acme', mode: 'insensitive' } });
  });

  it('trims a whitespace-padded q', async () => {
    await request(makeApp()).get('/api/admin/users?q=%20acme%20').expect(200);
    expect(lastFind().where.email.contains).toBe('acme');
  });

  // The filter that used to live in the browser.
  it('role → an exact match, applied server-side', async () => {
    await request(makeApp()).get('/api/admin/users?role=ADMIN').expect(200);
    expect(lastFind().where).toEqual({ role: 'ADMIN' });
  });

  it('q and role compose', async () => {
    await request(makeApp()).get('/api/admin/users?q=acme&role=VIEWER').expect(200);
    expect(lastFind().where).toEqual({
      email: { contains: 'acme', mode: 'insensitive' },
      role: 'VIEWER',
    });
  });

  // User.role is a Prisma ENUM: forwarding an unrecognised value throws a
  // validation error and surfaces as a 500 rather than an empty result.
  it('drops a role that is not in the enum instead of 500ing', async () => {
    const res = await request(makeApp()).get('/api/admin/users?role=SUPERUSER').expect(200);
    expect(lastFind().where).toEqual({});
    expect(res.body.users).toHaveLength(1);
  });

  it('is case-sensitive about the enum — "admin" is not ADMIN', async () => {
    await request(makeApp()).get('/api/admin/users?role=admin').expect(200);
    expect(lastFind().where).toEqual({});
  });

  it('no filters → no where clause', async () => {
    await request(makeApp()).get('/api/admin/users').expect(200);
    expect(lastFind().where).toEqual({});
  });
});

describe('GET /users — pagination guards', () => {
  it('defaults to 25 per page', async () => {
    await request(makeApp()).get('/api/admin/users').expect(200);
    expect(lastFind()).toMatchObject({ take: 25, skip: 0 });
  });

  it('respects limit and offset', async () => {
    await request(makeApp()).get('/api/admin/users?limit=50&offset=100').expect(200);
    expect(lastFind()).toMatchObject({ take: 50, skip: 100 });
  });

  it('caps limit at the configured maximum', async () => {
    await request(makeApp()).get('/api/admin/users?limit=99999').expect(200);
    expect(lastFind().take).toBe(200);
  });

  it('a non-numeric limit falls back to the default', async () => {
    await request(makeApp()).get('/api/admin/users?limit=abc').expect(200);
    expect(lastFind().take).toBe(25);
    expect(Number.isNaN(lastFind().take)).toBe(false);
  });

  it('a negative offset clamps to 0', async () => {
    await request(makeApp()).get('/api/admin/users?offset=-10').expect(200);
    expect(lastFind().skip).toBe(0);
  });
});

describe('GET /users — shape and failure', () => {
  it('still flattens the workspace relation', async () => {
    const res = await request(makeApp()).get('/api/admin/users').expect(200);
    expect(res.body.users[0]).toMatchObject({ workspaceId: 'w1', workspaceName: 'Acme' });
  });

  it('a user with no workspace reports null, not a guess', async () => {
    prisma.user.findMany.mockResolvedValue([row({ workspace: null })]);
    const res = await request(makeApp()).get('/api/admin/users').expect(200);
    expect(res.body.users[0]).toMatchObject({ workspaceId: null, workspaceName: null });
  });

  it('returns { error } — never a trace — when the count fails', async () => {
    prisma.user.count.mockRejectedValue(new Error('connection refused'));
    const res = await request(makeApp()).get('/api/admin/users').expect(500);
    expect(res.body).toEqual({ error: 'Failed to list users' });
  });
});
