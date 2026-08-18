// ============================================================
// requireWorkspace — R11 (I60) negative controls
// ------------------------------------------------------------
// The whole point of this middleware is that removing it makes these fail.
// Before R11 an authenticated request with no resolvable workspace reached the
// handlers, which then queried `workspaceId: null` against a non-nullable UUID
// column and returned 200 with an empty account.
// ============================================================
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireWorkspace } from './requireWorkspace.js';

function run(req) {
  const out = { status: 200, body: null, passed: false };
  const res = {
    status(code) { out.status = code; return this; },
    json(body)   { out.body = body; return this; },
  };
  requireWorkspace(req, res, () => { out.passed = true; });
  return out;
}

describe('requireWorkspace', () => {
  it('passes a request carrying a workspace', () => {
    const out = run({ workspaceId: 'ws-1', userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(true);
    expect(out.body).toBeNull();
  });

  it('refuses with 409 when the workspace is null', () => {
    const out = run({ workspaceId: null, userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ error: 'NoWorkspace' });
  });

  it('refuses with 409 when the workspace is undefined', () => {
    const out = run({ userId: 'uid-1', path: '/x', method: 'GET' });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(409);
  });

  it('refuses with 409 — never 200 and never an empty payload', () => {
    // The failure mode being locked out: a 200 whose body reads as "you have
    // no campaigns". 409 says "we could not determine your account", which is
    // a different sentence and the true one.
    const out = run({ workspaceId: '', userId: 'uid-1', path: '/api/lumi/home', method: 'GET' });
    expect(out.status).not.toBe(200);
    expect(out.body).not.toEqual([]);
    expect(out.body).toMatchObject({ error: 'NoWorkspace' });
  });
});
