// ============================================================
// GET /api/lumi/roles/me — the seat REPORT contract (R-14.a, Phase 5.14)
// ------------------------------------------------------------
// Phase 5.13 recorded this route as NOT COVERED at route level: the
// STRATEGIST-on-outage behaviour was asserted only inside the middleware, so
// nothing held the published RESPONSE to a contract. These controls do.
//
// The defect being pinned: the endpoint answered
// `resolveCollabRoleForDisplay`, which maps every failure onto DEFAULT_ROLE, so
// a database blip or an unassigned seat was published as
// `{role:'STRATEGIST'}` with a 200 — and the client, seeing a role it knows,
// recorded a CONFIRMED seat. "unknown → permitted", one field wide.
//
// The real requireCollabRole executes here; only prisma and the logger are
// mocked, so the resolution path under test is the production one.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
    stakeholderNarrative: { findFirst: vi.fn().mockResolvedValue(null) },
    approvalRequest: { count: vi.fn().mockResolvedValue(0) },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { collaborationRouter } from './collaboration.js';
import { prisma } from '../../lib/prisma.js';

/**
 * `collabRole` is deliberately NOT pre-set on req unless a case asks for it, so
 * resolution actually goes to the store — which is where the defect lived.
 */
function makeApp({ userId = 'firebase-user-1', userRole, collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = userId;
    req.workspaceId = 'ws1';
    if (userRole !== undefined) req.userRole = userRole;
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', collaborationRouter);
  return app;
}

const get = (opts) => request(makeApp(opts)).get('/roles/me');

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /roles/me — a resolved seat', () => {
  for (const role of ['STRATEGIST', 'BUYER', 'CLIENT']) {
    it(role + ' is reported as RESOLVED, with its visibleStates', async () => {
      prisma.user.findUnique.mockResolvedValue({ collabRole: role });
      const res = await get().expect(200);
      expect(res.body.role).toBe(role);
      expect(res.body.roleStatus).toBe('RESOLVED');
      expect(res.body.roleReason).toBeNull();
      expect(Array.isArray(res.body.visibleStates)).toBe(true);
      expect(res.body.visibleStates.length).toBeGreaterThan(0);
    });
  }

  it('a CLIENT is not widened — visibleStates stays the narrow list', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'CLIENT' });
    const res = await get().expect(200);
    expect(res.body.visibleStates).toEqual(['REPORT']);
  });
});

// ── The ruling ──────────────────────────────────────────────────────
describe('GET /roles/me — R-14.a: an unresolved seat is never STRATEGIST', () => {
  it('REGRESSION: a role LOOKUP FAILURE publishes null, not STRATEGIST', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const res = await get().expect(200);
    expect(res.body.role).toBeNull();
    expect(res.body.role).not.toBe('STRATEGIST');
    expect(res.body.roleStatus).toBe('UNRESOLVED');
    expect(res.body.roleReason).toBe('ROLE_LOOKUP_FAILED');
  });

  it('REGRESSION: an UNSET collabRole publishes null, not STRATEGIST', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const res = await get().expect(200);
    expect(res.body.role).toBeNull();
    expect(res.body.roleStatus).toBe('UNRESOLVED');
    expect(res.body.roleReason).toBe('ROLE_UNSET');
  });

  // NOT REACHABLE through the store: User.collabRole is a Prisma enum
  // (WorkspaceRole?), so only STRATEGIST | BUYER | CLIENT | null can be
  // written. This is a FORWARD guard — the day the enum gains a fourth value,
  // the gate must deny it rather than enforce it as STRATEGIST.
  it('a role value the gate does not recognise publishes null, not a default', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'SUPERUSER' });
    const res = await get().expect(200);
    expect(res.body.role).toBeNull();
    expect(res.body.roleStatus).toBe('UNRESOLVED');
    expect(res.body.roleReason).toBe('ROLE_UNKNOWN');
    expect(res.body.visibleStates).toBeNull();
  });

  it('a missing user row is not reported as an assigned or merely unset seat', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await get().expect(200);
    expect(res.body).toMatchObject({ role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_IDENTITY_MISSING', visibleStates: null });
  });

  it('REGRESSION: visibleStates is WITHHELD when the seat is unknown', async () => {
    // visibleStates(null) resolves through normalizeRole to the STRATEGIST
    // list — the same leak, one field over.
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const res = await get().expect(200);
    expect(res.body.visibleStates).toBeNull();
    // Self-refutation: the STRATEGIST list is what would leak, so prove it is
    // what a RESOLVED strategist actually gets.
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'STRATEGIST' });
    expect((await get().expect(200)).body.visibleStates).toContain('PORTFOLIO');
  });

  it('the two unresolved reasons are DISTINCT — different next steps', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const failed = (await get().expect(200)).body.roleReason;
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    const unset = (await get().expect(200)).body.roleReason;
    expect(failed).toBe('ROLE_LOOKUP_FAILED');
    expect(unset).toBe('ROLE_UNSET');
    expect(failed).not.toBe(unset);
  });
});

// ── Why the response is a 200 ───────────────────────────────────────
describe('GET /roles/me — the status code, and the orthogonal ADMIN axis', () => {
  it('answers 200 even when the seat cannot be established', async () => {
    // Not a 403: nothing refused us, and the client maps 403 to NOT_PERMITTED,
    // which would turn an outage into a refusal — the R-14 inversion, reversed.
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    await get().expect(200);
  });

  it('REGRESSION: an ADMIN keeps their userRole when the COLLAB seat fails', async () => {
    // The two axes are orthogonal. Failing the whole response would take a
    // genuine ADMIN's panel away because an unrelated store was unavailable.
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const res = await get({ userRole: 'ADMIN' }).expect(200);
    expect(res.body.userRole).toBe('ADMIN');
    expect(res.body.roleStatus).toBe('UNRESOLVED');
  });

  it('userRole defaults to VIEWER — the narrow seat, never ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'BUYER' });
    const res = await get().expect(200);
    expect(res.body.userRole).toBe('VIEWER');
  });
});

// ── The shape itself ────────────────────────────────────────────────
describe('GET /roles/me — response contract', () => {
  it('always carries every field, so a consumer never infers one from absence', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'BUYER' });
    const resolved = (await get().expect(200)).body;
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const unresolved = (await get().expect(200)).body;

    const KEYS = ['role', 'roleStatus', 'roleReason', 'visibleStates', 'userRole'];
    for (const k of KEYS) {
      expect(Object.prototype.hasOwnProperty.call(resolved, k)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(unresolved, k)).toBe(true);
    }
  });

  it('roleStatus is one of exactly two values', async () => {
    prisma.user.findUnique.mockResolvedValue({ collabRole: 'BUYER' });
    expect(['RESOLVED', 'UNRESOLVED']).toContain((await get()).body.roleStatus);
    prisma.user.findUnique.mockResolvedValue({ collabRole: null });
    expect(['RESOLVED', 'UNRESOLVED']).toContain((await get()).body.roleStatus);
  });
});
