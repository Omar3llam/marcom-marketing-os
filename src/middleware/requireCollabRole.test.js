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
  resolveCollabRoleContext, requireResolvedCollabRole, ROLE_UNRESOLVED_REASON, RoleUnavailableError,
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

describe('display resolution never invents STRATEGIST', () => {
  it('returns null on a lookup failure', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBeNull();
  });

  it('returns null on an unset role', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBeNull();
  });

  it('returns null for a future role', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'FUTURE_ROLE' });
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBeNull();
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
    expect(ctx.reason).toBe(ROLE_UNRESOLVED_REASON.ROLE_UNKNOWN);
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
    expect(ctx.reason).toBe(ROLE_UNRESOLVED_REASON.ROLE_IDENTITY_MISSING);
  });
});

describe('requireResolvedCollabRole — role-scoped reads', () => {
  it.each(['STRATEGIST', 'BUYER', 'CLIENT'])('passes a resolved %s through', async (role) => {
    const out = await run(requireResolvedCollabRole, { collabRole: role, userId: 'u1' });
    expect(out.passed).toBe(true);
  });

  it('returns not-configured for an unset role', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const out = await run(requireResolvedCollabRole, { userId: 'u1' });
    expect(out).toMatchObject({ status: 409, passed: false, body: { error: 'RoleNotConfigured', roleReason: 'ROLE_UNSET' } });
  });

  it('returns error for a failed lookup', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    const out = await run(requireResolvedCollabRole, { userId: 'u1' });
    expect(out).toMatchObject({ status: 503, passed: false, body: { error: 'RoleUnavailable', roleReason: 'ROLE_LOOKUP_FAILED' } });
  });

  it('does not pass an unknown or future role', async () => {
    const out = await run(requireResolvedCollabRole, { collabRole: 'FUTURE_ROLE', userId: 'u1' });
    expect(out).toMatchObject({ status: 503, passed: false, body: { roleReason: 'ROLE_UNKNOWN' } });
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
