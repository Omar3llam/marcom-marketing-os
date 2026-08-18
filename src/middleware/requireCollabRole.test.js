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

import { requireCollabRole, resolveCollabRole, resolveCollabRoleForDisplay, RoleUnavailableError } from './requireCollabRole.js';
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
  it('resolveCollabRoleForDisplay defaults an outage to the default seat', async () => {
    // Deliberate asymmetry: a screen that cannot resolve a role still renders,
    // while an action that cannot resolve one is refused. The direction matters
    // — the reverse (strict display, generous gate) is the bug R11 removed.
    prisma.user.findUnique.mockRejectedValue(new Error('down'));
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBe('STRATEGIST');
  });

  it('resolveCollabRoleForDisplay never throws on a null role', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    await expect(resolveCollabRoleForDisplay({ userId: 'u1' })).resolves.toBe('STRATEGIST');
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
