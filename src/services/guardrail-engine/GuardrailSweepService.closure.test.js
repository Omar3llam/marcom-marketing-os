// ============================================================
// C-05 · why a guardrail episode closed
// ------------------------------------------------------------
// C-02 gave an episode a beginning and an end. It did not give the END a
// REASON, because there was only one way to end: a sweep judged the pair and
// found no breach.
//
// C-05 adds a second way — a person revoked the rule's authority — and the two
// must not share a shape. `RESOLVED · resolvedAt · openHitKey null` describes
// both, and read from a row that is all a later reader gets.
//
// So the natural closer states its reason too. Otherwise `closureReason IS
// NULL` would mean "the condition cleared, or this row predates the column",
// and the distinction would be born already collapsed.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot: { findMany: vi.fn() },
    guardrailRule:  { findMany: vi.fn() },
    decision:       { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction:   vi.fn(async (ops) => Promise.all(ops)),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { sweepGuardrails } from './GuardrailSweepService.js';

const WS = 'ws-closure';

const RULE = {
  id: 'rule-1', name: 'Frequency ceiling', enabled: true, scopeLevel: 'ADSET',
  metric: 'frequency', comparator: 'GT', threshold: 3.0, sustainedDays: 2, emitVerdict: 'WATCH',
};

const snap = (over = {}) => ({
  entityId: 'e1', entityLevel: 'ADSET', date: new Date('2026-08-10T00:00:00Z'),
  frequency: 4.0, roas: 1.2, ctr: 0.01, cpaMinor: 500, spendMinor: 10_000, currency: 'EGP',
  ...over,
});

/** Two consecutive days under the ceiling: the pair is judged, and it is CLEAR. */
const clearSeries = () => [
  snap({ frequency: 1.1, date: new Date('2026-08-10T00:00:00Z') }),
  snap({ frequency: 1.2, date: new Date('2026-08-11T00:00:00Z') }),
];

const closingWrite = () => prisma.decision.updateMany.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  prisma.guardrailRule.findMany.mockResolvedValue([RULE]);
  prisma.decision.createMany.mockResolvedValue({ count: 0 });
  prisma.decision.updateMany.mockResolvedValue({ count: 1 });
});

describe('the natural close names itself', () => {
  it('a breach that ended closes as CONDITION_CLEARED', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(clearSeries());
    prisma.decision.findMany.mockResolvedValue([{ id: 'dec-open', openHitKey: 'rule-1:e1:ADSET' }]);

    const out = await sweepGuardrails(WS);

    expect(out.episodesClosed).toBe(1);
    expect(closingWrite().data.closureReason).toBe('CONDITION_CLEARED');
    expect(closingWrite().data.status).toBe('RESOLVED');
  });

  it('still refuses to write a resolution — closing is not an outcome', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(clearSeries());
    prisma.decision.findMany.mockResolvedValue([{ id: 'dec-open', openHitKey: 'rule-1:e1:ADSET' }]);

    await sweepGuardrails(WS);

    // Unchanged by C-05, and asserted here so the new field cannot drag one in
    // behind it: `resolution IS NOT NULL` is half of the learning predicate.
    expect(closingWrite().data.resolution).toBeUndefined();
    expect(closingWrite().data.openHitKey).toBeNull();
  });

  it('a pair it never judged is still not closed, with or without a reason', async () => {
    // C-02's load-bearing absence. A rule switched off produces no evaluation,
    // and no evaluation must never read as an all-clear.
    prisma.guardrailRule.findMany.mockResolvedValue([]);

    const out = await sweepGuardrails(WS);

    expect(out.episodesClosed).toBe(0);
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });
});
