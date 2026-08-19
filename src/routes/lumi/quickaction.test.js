// ============================================================
// R13-D / B3-C — quick actions are retired, and say so
// ============================================================
// A signed one-click link used to answer `{ ok: true, enqueued: true }` and
// hand the work to the legacy Action worker, whose stub executors performed no
// platform mutation. The link therefore reported that an ad-account change was
// under way when nothing would ever happen.
//
// Two properties matter here and they pull in opposite directions: the endpoint
// must refuse everyone, AND it must still refuse a FORGED token differently
// from a valid one — signature verification is this endpoint's only
// authorization, and retiring the feature is not a reason to stop checking it.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const verifyQuickAction = vi.hoisted(() => vi.fn());
vi.mock('../../utils/hmac.js', () => ({ verifyQuickAction }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { action: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { quickActionRouter } = await import('./quickaction.js');
const { LEGACY_RETIRED_CODE } = await import('./rollback.js');
const { prisma } = await import('../../lib/prisma.js');

const VALID = { ok: true, actionId: 'a1', workspaceId: 'w1', actorId: 'u1', scope: 'execute' };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/quick-action', quickActionRouter);
  return app;
}
const post = (body = { token: 't', sig: 's' }) =>
  request(makeApp()).post('/quick-action').send(body);

beforeEach(() => {
  vi.clearAllMocks();
  verifyQuickAction.mockReturnValue(VALID);
});

describe('a valid signed link is refused honestly', () => {
  it('answers 501 with the shared retirement code', async () => {
    const res = await post();
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('QuickActionUnsupported');
    expect(res.body.code).toBe(LEGACY_RETIRED_CODE);
  });

  it('reports enqueued:false — the field the old response set to true', async () => {
    const res = await post();
    expect(res.body.enqueued).toBe(false);
    expect(res.body.ok).toBeUndefined();
  });

  it('touches no Action row at all', async () => {
    await post();
    expect(prisma.action.findFirst).not.toHaveBeenCalled();
    expect(prisma.action.create).not.toHaveBeenCalled();
    expect(prisma.action.update).not.toHaveBeenCalled();
  });
});

describe('signature verification still comes first', () => {
  it('a forged token is 401, not 501', async () => {
    // A forged token must learn "your signature is bad", never the feature's
    // status — and must not be answered as though it had been accepted.
    verifyQuickAction.mockReturnValue({ ok: false, reason: 'bad_signature' });
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('InvalidQuickAction');
    expect(res.body.reason).toBe('bad_signature');
  });

  it.each(['expired', 'malformed_token', 'missing_token_or_sig'])(
    'a %s token is still rejected as invalid', async (reason) => {
      verifyQuickAction.mockReturnValue({ ok: false, reason });
      const res = await post();
      expect(res.status).toBe(401);
      expect(res.body.reason).toBe(reason);
    });

  it('the signature is checked even though the answer is always a refusal', async () => {
    await post();
    expect(verifyQuickAction).toHaveBeenCalledTimes(1);
  });
});
