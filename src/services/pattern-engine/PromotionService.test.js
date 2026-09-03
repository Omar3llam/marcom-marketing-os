// ============================================================
// C-05 · PromotionService — autonomy is granted, and can be taken back
// ------------------------------------------------------------
// R-13: promotion grants Lumi durable authority over later judgments, so it
//       requires an explicit authorization. One call that both proposes and
//       grants is the thing this slice removes.
// R-14: that authorization is revocable, and revoking it must not rewrite
//       history — neither the grant record nor the breaches the rule was
//       holding open.
//
// The heaviest assertion in the file is "an administratively closed episode is
// never a resolved outcome". A closure that looked like a resolved outcome
// would teach institutional memory that revoking a rule fixed a campaign.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  const prisma = {
    accountPattern: model(), approvalRequest: model(), collaborationEvent: model(),
    guardrailRule: model(), decision: model(),
  };
  // The callback form PlaybookService already uses: one transaction, and the
  // handle it hands out is the same set of models.
  prisma.$transaction = vi.fn(async (fn) => fn(prisma));
  return { prisma };
});

import { prisma } from '../../lib/prisma.js';
import { requestPromotion, decidePromotion, revokePromotion } from './PromotionService.js';
import { AUTONOMY_EVENT } from './promotionSnapshot.js';

const WS = 'ws-1';

const pattern = (over = {}) => ({
  id: 'pat-1', workspaceId: WS, patternKey: 'freq:cold:ADSET', kind: 'FATIGUE_THRESHOLD',
  statement: 'On cold adsets, KILL once frequency passes ~3.5', basis: '14 outcomes',
  status: 'ESTABLISHED', support: 14, effectiveSupport: 9.2, accuracy: 0.85, confidence: 0.81,
  metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'cold', comparator: 'GTE',
  threshold: 3.5, unit: 'RATIO', emitVerdict: 'KILL', sustainedDays: 1, promotedRuleId: null,
  firstObservedAt: new Date('2026-06-01T00:00:00Z'), lastObservedAt: new Date('2026-08-30T00:00:00Z'),
  ...over,
});

const pendingRequest = (over = {}) => ({
  id: 'req-1', workspaceId: WS, subjectType: 'PATTERN_PROMOTION', subjectId: 'pat-1',
  planId: null, requestedById: 'user-a', state: 'PENDING',
  createdAt: new Date('2026-09-03T10:00:00Z'), ...over,
});

const events = () => prisma.collaborationEvent.create.mock.calls.map((c) => c[0].data);
const eventOf = (type) => events().find((e) => e.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  prisma.approvalRequest.findFirst.mockResolvedValue(null);
  prisma.collaborationEvent.create.mockResolvedValue({ id: 'ev-1' });
  prisma.decision.updateMany.mockResolvedValue({ count: 0 });
  prisma.accountPattern.updateMany.mockResolvedValue({ count: 1 });
});

// ── 1 · PROPOSING IS NOT GRANTING ───────────────────────────────────────────
describe('requestPromotion', () => {
  it('opens a PENDING authorization and creates NO rule', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    prisma.approvalRequest.create.mockResolvedValue(pendingRequest());

    const out = await requestPromotion(WS, { patternId: 'pat-1', requestedById: 'user-a' });

    expect(out).toMatchObject({ requestId: 'req-1', state: 'PENDING' });
    // R-13, stated as an assertion: nothing may grant autonomy on one call.
    expect(prisma.guardrailRule.create).not.toHaveBeenCalled();
    expect(prisma.accountPattern.update).not.toHaveBeenCalled();
    expect(eventOf('APPROVAL_REQUESTED')).toBeTruthy();
    expect(eventOf(AUTONOMY_EVENT.GRANTED)).toBeUndefined();
  });

  it('files against ApprovalRequest without touching the plan gate', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    prisma.approvalRequest.create.mockResolvedValue(pendingRequest());
    await requestPromotion(WS, { patternId: 'pat-1', requestedById: 'user-a' });

    const data = prisma.approvalRequest.create.mock.calls[0][0].data;
    expect(data.subjectType).toBe('PATTERN_PROMOTION');
    expect(data.subjectId).toBe('pat-1');
    // Plan.requiresApproval belongs to allocation. Promotion carries its own
    // authorization semantics rather than borrowing that switch.
    expect(data.planId).toBeNull();
  });

  it('records the belief as it stood when the request was filed', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    prisma.approvalRequest.create.mockResolvedValue(pendingRequest());
    await requestPromotion(WS, { patternId: 'pat-1', requestedById: 'user-a' });

    expect(eventOf('APPROVAL_REQUESTED').detail.beliefAtRequest.accuracy).toBe(0.85);
  });

  it('applies the SAME governance gate as the promotion itself', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern({ status: 'CONFLICTED' }));
    await expect(requestPromotion(WS, { patternId: 'pat-1', requestedById: 'user-a' }))
      .rejects.toThrow(/contested|CONFLICTED/i);
    expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('refuses a second request while one is already pending', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    prisma.approvalRequest.findFirst.mockResolvedValue(pendingRequest());
    await expect(requestPromotion(WS, { patternId: 'pat-1', requestedById: 'user-a' }))
      .rejects.toThrow(/pending/i);
  });

  it('refuses an authorization it cannot attribute to a person', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    // "Who proposed this" is half of what R-13 requires the trail to prove.
    await expect(requestPromotion(WS, { patternId: 'pat-1', requestedById: null }))
      .rejects.toThrow(/requestedById/i);
  });
});

// ── 2 · THE DECISION ────────────────────────────────────────────────────────
describe('decidePromotion', () => {
  beforeEach(() => {
    prisma.approvalRequest.findFirst.mockResolvedValue(pendingRequest());
    prisma.approvalRequest.update.mockResolvedValue(pendingRequest({ state: 'APPROVED' }));
    prisma.accountPattern.findFirst.mockResolvedValue(pattern());
    prisma.guardrailRule.create.mockResolvedValue({
      id: 'rule-1', name: 'Learned: On cold adsets', metric: 'frequency', comparator: 'GTE',
      threshold: 3.5, unit: 'RATIO', scopeLevel: 'ADSET', audienceTag: 'cold',
      sustainedDays: 1, emitVerdict: 'KILL',
    });
    prisma.accountPattern.update.mockResolvedValue(pattern({ promotedRuleId: 'rule-1' }));
  });

  it('only a STRATEGIST may grant autonomy', async () => {
    await expect(decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-b', approverRole: 'BUYER' }))
      .rejects.toMatchObject({ code: 'RoleForbidden' });
    expect(prisma.guardrailRule.create).not.toHaveBeenCalled();
  });

  it('APPROVED creates the rule, links it, and writes the frozen snapshot — one transaction', async () => {
    const out = await decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST' });

    expect(out).toMatchObject({ state: 'APPROVED', ruleId: 'rule-1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.accountPattern.update.mock.calls[0][0].data.promotedRuleId).toBe('rule-1');

    const granted = eventOf(AUTONOMY_EVENT.GRANTED);
    expect(granted.subjectId).toBe('pat-1');           // the pattern is the spine
    expect(granted.detail.autonomy.ruleId).toBe('rule-1');
    expect(granted.detail.belief.accuracy).toBe(0.85); // by value, not a pointer
    expect(granted.detail.gate.requestId).toBe('req-1');
  });

  it('the created rule names the pattern it came from', async () => {
    await decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST' });
    // F-5: a promoted rule was indistinguishable from a hand-authored one.
    expect(prisma.guardrailRule.create.mock.calls[0][0].data.sourcePatternId).toBe('pat-1');
  });

  it('records self-approval as self-approval', async () => {
    await decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST' });
    expect(eventOf(AUTONOMY_EVENT.GRANTED).detail.gate.selfApproved).toBe(true);
  });

  it('a different approver is not marked self-approved', async () => {
    await decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-b', approverRole: 'STRATEGIST' });
    expect(eventOf(AUTONOMY_EVENT.GRANTED).detail.gate.selfApproved).toBe(false);
  });

  it('REJECTED grants nothing and leaves the pattern unpromoted', async () => {
    prisma.approvalRequest.update.mockResolvedValue(pendingRequest({ state: 'REJECTED' }));
    const out = await decidePromotion(WS, { requestId: 'req-1', decision: 'REJECTED', approverId: 'user-a', approverRole: 'STRATEGIST' });

    expect(out.state).toBe('REJECTED');
    expect(out.ruleId).toBeNull();
    expect(prisma.guardrailRule.create).not.toHaveBeenCalled();
    expect(prisma.accountPattern.update).not.toHaveBeenCalled();
    expect(eventOf('APPROVAL_DECIDED')).toBeTruthy();
  });

  // ── the divergence case ──────────────────────────────────────────────────
  it('refuses to grant on a belief that has degraded since the request', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern({ accuracy: 0.31 }));

    await expect(decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST' }))
      .rejects.toMatchObject({ code: 'BeliefDegraded' });
    expect(prisma.guardrailRule.create).not.toHaveBeenCalled();
  });

  it('keeps BOTH beliefs, and never reconciles them', async () => {
    prisma.accountPattern.findFirst.mockResolvedValue(pattern({ accuracy: 0.31, status: 'CONFLICTED' }));
    prisma.approvalRequest.update.mockResolvedValue(pendingRequest({ state: 'REJECTED' }));

    await decidePromotion(WS, {
      requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST',
      beliefAtRequest: { accuracy: 0.85, status: 'ESTABLISHED' },
    }).catch(() => {});

    const decided = eventOf('APPROVAL_DECIDED');
    // R-5: divergence between two records of the same thing is a FACT. The
    // refusal keeps what was believed then beside what is believed now.
    expect(decided.detail.beliefAtRequest.accuracy).toBe(0.85);
    expect(decided.detail.beliefAtDecision.accuracy).toBe(0.31);
    expect(decided.detail.outcome).toBe('REFUSED_BELIEF_DEGRADED');
    // and the row says the approver did not do this.
    expect(prisma.approvalRequest.update.mock.calls[0][0].data.reason).toBe('BELIEF_DEGRADED');
  });

  it('refuses a request that is no longer pending', async () => {
    prisma.approvalRequest.findFirst.mockResolvedValue(pendingRequest({ state: 'APPROVED' }));
    await expect(decidePromotion(WS, { requestId: 'req-1', decision: 'APPROVED', approverId: 'user-a', approverRole: 'STRATEGIST' }))
      .rejects.toThrow(/already/i);
  });
});

// ── 3 · REVOCATION ──────────────────────────────────────────────────────────
describe('revokePromotion', () => {
  const rule = (over = {}) => ({
    id: 'rule-1', workspaceId: WS, name: 'Learned: something', enabled: true,
    sourcePatternId: 'pat-1', revokedAt: null, ...over,
  });

  beforeEach(() => {
    prisma.guardrailRule.findFirst.mockResolvedValue(rule());
    prisma.guardrailRule.update.mockResolvedValue(rule({ enabled: false }));
    prisma.decision.updateMany.mockResolvedValue({ count: 2 });
  });

  it('disables the rule and stamps when — it never deletes it', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    const data = prisma.guardrailRule.update.mock.calls[0][0].data;

    expect(data.enabled).toBe(false);
    expect(data.revokedAt).toBeInstanceOf(Date);
    // R-14: the history is preserved. Nothing here rewrites the rule's origin.
    expect(data.sourcePatternId).toBeUndefined();
  });

  it('clears promotedRuleId so the pattern is promotable again', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    const call = prisma.accountPattern.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ workspaceId: WS, promotedRuleId: 'rule-1' });
    expect(call.data.promotedRuleId).toBeNull();
  });

  it('closes the open episodes of THIS rule, and no others', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    const where = prisma.decision.updateMany.mock.calls[0][0].where;

    expect(where.guardrailRuleId).toBe('rule-1');
    expect(where.workspaceId).toBe(WS);
    expect(where.openHitKey).toEqual({ not: null });
  });

  it('never writes over a decision a human already acted on', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    // EXECUTED / DISMISSED are claims a person made. Revoking a rule is not a
    // licence to restate them.
    expect(prisma.decision.updateMany.mock.calls[0][0].where.status).toBe('PROPOSED');
  });

  // ── INVARIANT 13 · the one that protects institutional memory ────────────
  it('an administratively closed episode is never a resolved outcome', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    const data = prisma.decision.updateMany.mock.calls[0][0].data;

    expect(data.status).toBe('RESOLVED');
    expect(data.closureReason).toBe('RULE_REVOKED');
    expect(data.openHitKey).toBeNull();

    // decisionLearning admits a row on `resolution IS NOT NULL` + an
    // intervention stamp. Writing either here would enrol every breach a
    // revoked rule was holding into the learning population as a SUCCESS —
    // teaching Lumi that switching a rule off improved the account.
    expect(data.resolution).toBeUndefined();
    expect(data.humanExecutedAt).toBeUndefined();
    expect(data.platformExecutedAt).toBeUndefined();
    expect(data.dismissedAt).toBeUndefined();
    expect(data.confidenceDelta).toBeUndefined();
  });

  it('writes the revocation to the same audit spine as the grant', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    const revoked = eventOf(AUTONOMY_EVENT.REVOKED);

    expect(revoked.subjectId).toBe('pat-1');
    expect(revoked.actorId).toBe('user-a');
    expect(revoked.detail.ruleId).toBe('rule-1');
    expect(revoked.detail.episodesClosed).toBe(2);
  });

  it('is one transaction — a half-revoked rule is not a state', async () => {
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to revoke twice', async () => {
    prisma.guardrailRule.findFirst.mockResolvedValue(rule({ enabled: false, revokedAt: new Date() }));
    await expect(revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' }))
      .rejects.toMatchObject({ code: 'AlreadyRevoked' });
  });

  it('refuses a rule from another workspace', async () => {
    prisma.guardrailRule.findFirst.mockResolvedValue(null);
    await expect(revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' }))
      .rejects.toMatchObject({ code: 'NotFound' });
  });

  it('falls back to the rule as its own subject when the rule predates provenance', async () => {
    prisma.guardrailRule.findFirst.mockResolvedValue(rule({ sourcePatternId: null }));
    await revokePromotion(WS, { ruleId: 'rule-1', actorId: 'user-a' });
    // A hand-authored rule has no pattern to hang its history on. Inventing one
    // would attribute it to a belief that never produced it.
    expect(eventOf(AUTONOMY_EVENT.REVOKED).subjectId).toBe('rule-1');
    expect(prisma.accountPattern.updateMany).toHaveBeenCalled();
  });
});
