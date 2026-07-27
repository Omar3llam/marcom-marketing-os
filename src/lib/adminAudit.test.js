// ============================================================
// recordAdminAction — best-effort by construction
// ------------------------------------------------------------
// The one property that matters more than what it writes: it must never throw.
// Every admin route awaits it AFTER the mutation has already succeeded, so a
// rejection here would turn a completed action into a 500 the operator reads
// as "it failed" — and then retries.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma.js', () => ({ prisma: { adminAuditLog: { create: vi.fn() } } }));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { recordAdminAction } from './adminAudit.js';

const opts = (over = {}) => ({
  actorUid: 'firebase-admin-1',
  actorEmail: 'ops@marcom.dev',
  type: 'CHANGE_ROLE',
  targetType: 'USER',
  targetId: 'u-1',
  workspaceId: 'ws-1',
  ...over,
});

const written = () => prisma.adminAuditLog.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'log-1' });
});

describe('recordAdminAction — the write', () => {
  it('persists every field it was given', async () => {
    await recordAdminAction(opts({ before: { plan: 'FREE' }, after: { plan: 'PRO' } }));
    expect(written()).toEqual({
      actorUid: 'firebase-admin-1',
      actorEmail: 'ops@marcom.dev',
      type: 'CHANGE_ROLE',
      targetType: 'USER',
      targetId: 'u-1',
      workspaceId: 'ws-1',
      before: { plan: 'FREE' },
      after: { plan: 'PRO' },
    });
  });

  it('returns true when the row lands', async () => {
    await expect(recordAdminAction(opts())).resolves.toBe(true);
  });

  it('defaults the optional fields to null rather than undefined', async () => {
    await recordAdminAction({ actorUid: 'a', type: 'SEED_DEMO', targetType: 'WORKSPACE', targetId: 'ws-9' });
    expect(written()).toMatchObject({ workspaceId: null, before: null, after: null });
  });

  // An operator reading the log needs a name, not a blank cell.
  it('falls back to "unknown" when the token carried no email', async () => {
    await recordAdminAction(opts({ actorEmail: undefined }));
    expect(written().actorEmail).toBe('unknown');
  });
});

describe('recordAdminAction — best effort', () => {
  it('swallows a prisma rejection instead of rethrowing', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(new Error('relation does not exist'));
    await expect(recordAdminAction(opts())).resolves.toBe(false);
  });

  it('swallows a synchronous throw too (e.g. an unmocked client)', async () => {
    prisma.adminAuditLog.create.mockImplementation(() => { throw new TypeError('not a function'); });
    await expect(recordAdminAction(opts())).resolves.toBe(false);
  });

  // A failure that vanished entirely would be worse than the missing row.
  it('warns with the context needed to reconstruct the lost row', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(new Error('connection reset'));
    await recordAdminAction(opts({ type: 'DELETE_DEMO', targetId: 'ws-7' }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELETE_DEMO', targetId: 'ws-7', actorUid: 'firebase-admin-1' }),
      expect.stringMatching(/NOT recorded/),
    );
  });

  it('never throws even when called with nothing at all', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(new Error('null constraint'));
    await expect(recordAdminAction()).resolves.toBe(false);
  });
});
