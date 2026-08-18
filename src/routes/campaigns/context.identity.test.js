// ============================================================
// /api/campaigns/me/context — identity boundary  (R11 · I57 / I71)
// ------------------------------------------------------------
// This route was the account-takeover door. It resolved a User row with
// `OR: [{ clerkId }, { email }]` and then wrote `clerkId: <caller's uid>` onto
// whatever it found, so any authenticated caller could adopt an existing
// account by registering its email address — inheriting the workspace, the
// role, and the connected Meta credentials.
//
// These controls fail the moment either half comes back.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user:      { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mountContextRoutes } from './context.js';
import { prisma } from '../../lib/prisma.js';

// Minimal router double: captures the two handlers this module mounts.
function mount() {
  const handlers = {};
  const router = {
    get: (path, fn) => { handlers[`GET ${path}`] = fn; },
    put: (path, fn) => { handlers[`PUT ${path}`] = fn; },
  };
  mountContextRoutes(router);
  return handlers;
}

function invoke(handler, req) {
  return new Promise((resolve) => {
    const out = { status: 200, body: null };
    const res = {
      status(code) { out.status = code; return this; },
      json(body)   { out.body = body; resolve(out); return this; },
    };
    Promise.resolve(handler(req, res)).catch((err) => resolve({ status: -1, body: { thrown: err.message } }));
  });
}

const handlers = mount();
const GET = handlers['GET /me/context'];
const PUT = handlers['PUT /me/context'];

beforeEach(() => vi.clearAllMocks());

describe('GET /me/context — uid is the only key (I57)', () => {
  it('resolves by clerkId and never by email', async () => {
    prisma.user.findUnique.mockResolvedValue({ context: { name: 'Acme' } });

    const out = await invoke(GET, { userId: 'uid-caller', user: { email: 'victim@brand.com' } });

    expect(out.body).toEqual({ context: { name: 'Acme' } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where:  { clerkId: 'uid-caller' },
      select: { context: true },
    });
    // No findFirst → no OR clause → no email arm to hijack.
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('reports a read failure as 503, not as "not onboarded" (I71)', async () => {
    // The old code did `.catch(() => null)` then returned `{ context: null }`,
    // which the frontend reads as a brand-new account and bounces to
    // /onboarding. A DB outage must not look like a fresh signup.
    prisma.user.findUnique.mockRejectedValue(new Error('pool timeout'));

    const out = await invoke(GET, { userId: 'uid-caller', user: { email: 'a@b.com' } });

    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ error: 'ContextUnavailable' });
    expect(out.body.context).toBeUndefined();
  });
});

describe('PUT /me/context — no adoption, no body-supplied identity (I57/I59)', () => {
  const body = { context: { name: 'Acme', market: 'eg' } };

  it('resolves by clerkId only', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'row-1', workspaceId: 'ws-1', clerkId: 'uid-caller', email: 'me@brand.com' });
    prisma.user.update.mockResolvedValue({ id: 'row-1', workspaceId: 'ws-1', context: body.context });

    await invoke(PUT, { userId: 'uid-caller', user: { email: 'me@brand.com' }, body });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where:  { clerkId: 'uid-caller' },
      select: { id: true, workspaceId: true, clerkId: true, email: true },
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('NEVER writes clerkId on update — the row is found by it, not renamed to it', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'row-1', workspaceId: 'ws-1', clerkId: 'uid-caller', email: 'me@brand.com' });
    prisma.user.update.mockResolvedValue({ id: 'row-1', workspaceId: 'ws-1', context: body.context });

    await invoke(PUT, { userId: 'uid-caller', user: { email: 'me@brand.com' }, body });

    const updateArg = prisma.user.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ context: expect.any(Object) });
    expect(updateArg.data).not.toHaveProperty('clerkId');
    expect(updateArg.data).not.toHaveProperty('email');
  });

  it('ignores a request-body email — identity never comes from the body', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'row-new', workspaceId: 'ws-new', context: body.context });

    await invoke(PUT, {
      userId: 'uid-caller',
      user:   { email: 'me@brand.com' },
      body:   { ...body, email: 'victim@brand.com' },   // ← the injection attempt
    });

    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.email).toBe('me@brand.com');
    expect(createArg.clerkId).toBe('uid-caller');
  });

  it('falls back to a uid-derived placeholder when the token carries no email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'row-new', workspaceId: 'ws-new', context: body.context });

    await invoke(PUT, { userId: 'uid-caller', user: {}, body: { ...body, email: 'victim@brand.com' } });

    expect(prisma.user.create.mock.calls[0][0].data.email).toBe('uid-caller@unknown.local');
  });
});
