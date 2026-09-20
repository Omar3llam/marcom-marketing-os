// ============================================================
// requireCollabRole — R11 (I61 / I62) negative controls
// ------------------------------------------------------------
// The gate used to fail OPEN, to the highest privilege in the product: a
// swallowed DB error fell through to normalizeRole(null) ⇒ STRATEGIST. These
// controls fail if either half of that comes back.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  requireCollabRole, resolveCollabRole, resolveCollabRoleForDisplay,
  resolveCollabRoleContext, ROLE_UNRESOLVED_REASON, RoleUnavailableError,
} from './requireCollabRole.js';
import { _resetOverrideWarnings } from '../lib/devOverrides.js';
import { prisma } from '../lib/prisma.js';

function run(gate, req) {
  return new Promise((resolve) => {
    const out = { status: 200, body: null, passed: false };
    const res = {
      status(code) { out.status = code; return this; },
      json(body)   { out.body = body; resolve(out); return this; },
    };
    gate(req, res, () => { out.passed = true; resolve(out); });
  });
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  _resetOverrideWarnings();
});
afterEach(() => { process.env = { ...ENV }; });

describe('requireCollabRole — happy paths still work', () => {
  it('passes a permitted role straight through', async () => {
    const out = await run(requireCollabRole('STRATEGIST'), { collabRole: 'STRATEGIST', userId: 'u1', path: '/x' });
    expect(out.passed).toBe(true);
  });

  it('403s a role outside the allowed set', async () => {
    const out = await run(requireCollabRole('STRATEGIST'), { collabRole: 'CLIENT', userId: 'u1', path: '/x' });
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ error: 'RoleForbidden', role: 'CLIENT' });
  });

  it('falls back to the DB when req.collabRole is unset', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'BUYER' });
    const out = await run(requireCollabRole('BUYER', 'STRATEGIST'), { userId: 'u1', path: '/x' });
    expect(out.passed).toBe(true);
  });
});

describe('the gate fails CLOSED (I61)', () => {
  // ── NC-B5 · the control ────────────────────────────────────
  it('answers 503 when the role lookup throws — never a role, never a pass', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('connection pool timeout'));

    const out = await run(requireCollabRole('STRATEGIST'), { userId: 'u1', path: '/api/execute/meta' });

    expect(out.passed).toBe(false);
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ error: 'RoleUnavailable' });
  });

  it('403s a genuinely unset role rather than promoting it to STRATEGIST', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });

    const out = await run(requireCollabRole('STRATEGIST'), { userId: 'u1', path: '/x' });

    expect(out.passed).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ role: null });
  });

  it('403s when there is no user at all to resolve a role from', async () => {
    const out = await run(requireCollabRole('STRATEGIST'), { path: '/x' });
    expect(out.status).toBe(403);
  });

  it('resolveCollabRole surfaces the outage as RoleUnavailableError, not as a role', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    await expect(resolveCollabRole({ userId: 'u1' })).rejects.toBeInstanceOf(RoleUnavailableError);
  });
});

describe('display resolution is generous, enforcement is strict', () => {
  // These two are KEPT, not deleted: resolveCollabRoleForDisplay still has three
  // callers (/inbox, /home, feedSurfacing) that SHAPE role-scoped content rather
  // than publish a seat, and its generosity is still deliberate there.
  //
  // R-14.a (Phase 5.14) narrowed what the asymmetry is allowed to reach. It may
  // decide what a view composes; it may NOT answer "what seat is this". The
  // renamed titles say which of the two each case is about, because the old
  // names read as a blanket endorsement of the default — and GET /roles/me
  // relied on exactly that reading.
  it('SHAPING: resolveCollabRoleForDisplay still defaults an outage to the default seat', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBe('STRATEGIST');
  });

  it('SHAPING: resolveCollabRoleForDisplay never throws on a null role', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBe('STRATEGIST');
  });
});

// ── R-14.a — PUBLISHING a seat has no default ───────────────────────────────
describe('resolveCollabRoleContext — the reporting resolver', () => {
  it('reports a resolved seat, with no reason', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'BUYER' });
    await expect(resolveCollabRoleContext({ userId: 'u1' }))
      .resolves.toEqual({ status: 'RESOLVED', role: 'BUYER', reason: null });
  });

  for (const role of ['STRATEGIST', 'BUYER', 'CLIENT']) {
    it(`carries ${role} through untouched`, async () => {
      prisma.user.findUnique.mockResolvedValue({ collabRole: role });
      const ctx = await resolveCollabRoleContext({ userId: 'u1' });
      expect(ctx).toEqual({ status: 'RESOLVED', role, reason: null });
    });
  }

  it('REGRESSION: an outage is UNRESOLVED — never STRATEGIST', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    const ctx = await resolveCollabRoleContext({ userId: 'u1' });
    expect(ctx.status).toBe('UNRESOLVED');
    expect(ctx.role).toBeNull();
    expect(ctx.reason).toBe(ROLE_UNRESOLVED_REASON.ROLE_LOOKUP_FAILED);
  });

  it('REGRESSION: an unset role is UNRESOLVED — never STRATEGIST', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const ctx = await resolveCollabRoleContext({ userId: 'u1' });
    expect(ctx.status).toBe('UNRESOLVED');
    expect(ctx.role).toBeNull();
    expect(ctx.reason).toBe(ROLE_UNRESOLVED_REASON.ROLE_UNSET);
  });

  it('a MALFORMED role value is UNRESOLVED, not passed through', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'SUPERUSER' });
    const ctx = await resolveCollabRoleContext({ userId: 'u1' });
    expect(ctx.status).toBe('UNRESOLVED');
    expect(ctx.role).toBeNull();
  });

  it('the two reasons are DISTINCT — they have different next steps', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    const failed = await resolveCollabRoleContext({ userId: 'u1' });
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const unset = await resolveCollabRoleContext({ userId: 'u1' });
    expect(failed.reason).not.toBe(unset.reason);
  });

  it('never throws — an endpoint that reports a seat must still answer', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    await expect(resolveCollabRoleContext({ userId: 'u1' })).resolves.toBeTruthy();
  });

  it('no userId (never authenticated) is UNRESOLVED, not a seat', async () => {
    const ctx = await resolveCollabRoleContext({});
    expect(ctx.status).toBe('UNRESOLVED');
    expect(ctx.role).toBeNull();
  });
});

describe('COLLAB_ROLE_OVERRIDE is inert in production (I62)', () => {
  it('honours the override outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.COLLAB_ROLE_OVERRIDE = 'STRATEGIST';

    const out = await run(requireCollabRole('STRATEGIST'), { collabRole: 'CLIENT', userId: 'u1', path: '/x' });

    expect(out.passed).toBe(true);
  });

  // ── NC-B7 · the control ────────────────────────────────────
  it('IGNORES the override in production — a stray env var is not a promotion', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COLLAB_ROLE_OVERRIDE = 'STRATEGIST';

    const out = await run(requireCollabRole('STRATEGIST'), { collabRole: 'CLIENT', userId: 'u1', path: '/x' });

    expect(out.passed).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ role: 'CLIENT' });
  });
});
