// ============================================================
// requireWorkspace — R11 (I60) negative controls
// ------------------------------------------------------------
// The whole point of this middleware is that removing it makes these fail.
// Before R11 an authenticated request with no resolvable workspace reached the
// handlers, which then queried `workspaceId: null` against a non-nullable UUID
// column and returned 200 with an empty account.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireWorkspace } from './requireWorkspace.js';
import { prisma } from '../lib/prisma.js';

beforeEach(() => { vi.clearAllMocks(); prisma.user.findUnique.mockResolvedValue(null); });

async function run(req) {
  const out = { status: 200, body: null, passed: false };
  const res = {
    status(code) { out.status = code; return this; },
    json(body)   { out.body = body; return this; },
  };
  await requireWorkspace(req, res, () => { out.passed = true; });
  return out;
}

describe('requireWorkspace', () => {
  it('passes a request carrying a workspace', async () => {
    const out = await run({ workspaceId: 'ws-1', userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(true);
    expect(out.body).toBeNull();
  });

  it('refuses with 409 when lookup confirms the workspace is absent', async () => {
    const out = await run({ workspaceId: null, userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ error: 'NoWorkspace' });
  });

  it('refuses with 409 when undefined context is confirmed absent', async () => {
    const out = await run({ userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(409);
  });

  it('refuses proven absence with 409 — never 200 and never an empty payload', async () => {
    // The failure mode being locked out: a 200 whose body reads as "you have
    // no campaigns". 409 says the successful read found no workspace.
    const out = await run({ workspaceId: '', userId: 'uid-1', path: '/api/lumi/home', method: 'GET' });
    expect(out.status).not.toBe(200);
    expect(out.body).not.toEqual([]);
    expect(out.body).toMatchObject({ error: 'NoWorkspace' });
  });

  it('establishes missing context from a successful lookup', async () => {
    prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws-found' });
    const req = { userId: 'uid-1' };
    expect((await run(req)).passed).toBe(true);
    expect(req.workspaceId).toBe('ws-found');
  });

  it('returns unavailable on read failure, without private details', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('private SQL and connection secret'));
    const out = await run({ userId: 'uid-1' });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(503);
    expect(out.body.error).toBe('WorkspaceUnavailable');
    expect(JSON.stringify(out.body)).not.toMatch(/private|SQL|secret|NoWorkspace/);
  });
});
