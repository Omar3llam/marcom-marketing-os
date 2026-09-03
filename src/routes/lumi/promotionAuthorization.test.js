// ============================================================
// C-05 · the promotion routes — one tap no longer grants autonomy
// ------------------------------------------------------------
// The old surface was `POST /patterns/:id/promote` → 201 { ruleId }: propose
// and grant in one call, by one person, with no record of either act beyond a
// log line. R-13 replaces it with an authorization that has two ends and a
// name attached to each, and R-14 gives it a way back.
//
// The removal is asserted, not assumed. Leaving the old route as a quiet alias
// would keep an ungated path to durable autonomy — which is the defect, not a
// compatibility courtesy.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/network-engine/NetworkService.js', () => ({
  setConsent: vi.fn(), getNetworkInsights: vi.fn(),
}));
vi.mock('../../services/pattern-engine/PatternService.js', () => ({ readBriefing: vi.fn() }));
vi.mock('../../services/pattern-engine/PromotionService.js', () => ({
  requestPromotion: vi.fn(), decidePromotion: vi.fn(), revokePromotion: vi.fn(),
  PROMOTION_STATE: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { memoryRouter } from './memory.js';
import { prisma } from '../../lib/prisma.js';
import { requestPromotion, decidePromotion, revokePromotion } from '../../services/pattern-engine/PromotionService.js';

function makeApp({ collabRole = 'STRATEGIST' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-uid-1';
    req.workspaceId = 'workspace-1';
    req.collabRole = collabRole;
    next();
  });
  app.use('/', memoryRouter);
  return app;
}

const err = (code, message) => Object.assign(new Error(message), { code });

beforeEach(() => {
  vi.clearAllMocks();
  // The actor is a User row uuid. `req.userId` is a Firebase uid, and the
  // audit columns are @db.Uuid — the two are not the same string.
  prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });
});

describe('the one-call promotion is gone', () => {
  it('POST /patterns/:id/promote no longer exists', async () => {
    await request(makeApp()).post('/patterns/pat-1/promote').send({}).expect(404);
  });
});

describe('POST /patterns/:id/promotion-request', () => {
  it('files a PENDING authorization under the caller identity', async () => {
    requestPromotion.mockResolvedValue({ requestId: 'req-1', state: 'PENDING' });

    const res = await request(makeApp()).post('/patterns/pat-1/promotion-request').send({}).expect(201);

    expect(res.body).toMatchObject({ requestId: 'req-1', state: 'PENDING' });
    expect(requestPromotion).toHaveBeenCalledWith('workspace-1', {
      patternId: 'pat-1', requestedById: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('is STRATEGIST-only', async () => {
    await request(makeApp({ collabRole: 'BUYER' })).post('/patterns/pat-1/promotion-request').send({}).expect(403);
    expect(requestPromotion).not.toHaveBeenCalled();
  });

  it('refuses when the actor cannot be resolved to a person', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await request(makeApp()).post('/patterns/pat-1/promotion-request').send({}).expect(409);
    // An authorization nobody can be named for is not an authorization.
    expect(requestPromotion).not.toHaveBeenCalled();
  });

  it('surfaces a governance refusal as a client error, not a fault', async () => {
    requestPromotion.mockRejectedValue(err('NotPromotable', 'Pattern is not ESTABLISHED yet'));
    const res = await request(makeApp()).post('/patterns/pat-1/promotion-request').send({}).expect(409);
    expect(res.body.error).toBe('NotPromotable');
  });
});

describe('POST /promotions/:requestId/decision', () => {
  it('APPROVED returns the rule the grant created', async () => {
    decidePromotion.mockResolvedValue({ state: 'APPROVED', ruleId: 'rule-1' });

    const res = await request(makeApp()).post('/promotions/req-1/decision')
      .send({ decision: 'APPROVED' }).expect(200);

    expect(res.body).toMatchObject({ state: 'APPROVED', ruleId: 'rule-1' });
    expect(decidePromotion.mock.calls[0][1]).toMatchObject({
      requestId: 'req-1', decision: 'APPROVED',
      approverId: '11111111-1111-1111-1111-111111111111', approverRole: 'STRATEGIST',
    });
  });

  it('rejects a decision that is neither APPROVED nor REJECTED', async () => {
    await request(makeApp()).post('/promotions/req-1/decision').send({ decision: 'MAYBE' }).expect(400);
    expect(decidePromotion).not.toHaveBeenCalled();
  });

  it('is STRATEGIST-only at the route as well as in the service', async () => {
    await request(makeApp({ collabRole: 'BUYER' })).post('/promotions/req-1/decision')
      .send({ decision: 'APPROVED' }).expect(403);
    expect(decidePromotion).not.toHaveBeenCalled();
  });

  it('a degraded belief is a 409 that says so, and carries both readings', async () => {
    decidePromotion.mockRejectedValue(Object.assign(
      err('BeliefDegraded', 'The pattern no longer meets the promotion floor'),
      { beliefAtRequest: { accuracy: 0.85 }, beliefAtDecision: { accuracy: 0.31 } },
    ));

    const res = await request(makeApp()).post('/promotions/req-1/decision')
      .send({ decision: 'APPROVED' }).expect(409);

    expect(res.body.error).toBe('BeliefDegraded');
    expect(res.body.beliefAtRequest.accuracy).toBe(0.85);
    expect(res.body.beliefAtDecision.accuracy).toBe(0.31);
  });
});

describe('POST /guardrails/:ruleId/revoke', () => {
  it('revokes and reports what it closed', async () => {
    revokePromotion.mockResolvedValue({ ruleId: 'rule-1', episodesClosed: 2 });

    const res = await request(makeApp()).post('/guardrails/rule-1/revoke').send({}).expect(200);

    expect(res.body).toMatchObject({ ruleId: 'rule-1', episodesClosed: 2 });
    expect(revokePromotion).toHaveBeenCalledWith('workspace-1', {
      ruleId: 'rule-1', actorId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('is STRATEGIST-only — withdrawing autonomy is the same tier as granting it', async () => {
    await request(makeApp({ collabRole: 'BUYER' })).post('/guardrails/rule-1/revoke').send({}).expect(403);
    expect(revokePromotion).not.toHaveBeenCalled();
  });

  it('a second revocation is a 409, never a silent success', async () => {
    revokePromotion.mockRejectedValue(err('AlreadyRevoked', 'This rule has already been revoked'));
    const res = await request(makeApp()).post('/guardrails/rule-1/revoke').send({}).expect(409);
    expect(res.body.error).toBe('AlreadyRevoked');
  });

  it('an unknown rule is a 404, not a 500', async () => {
    revokePromotion.mockRejectedValue(err('NotFound', 'Rule not found in this workspace'));
    await request(makeApp()).post('/guardrails/rule-1/revoke').send({}).expect(404);
  });
});
