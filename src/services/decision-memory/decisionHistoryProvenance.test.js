// ============================================================
// C-12 · T2 — the timeline states WHO acted, not just that someone did (RED)
// ------------------------------------------------------------
// `stated()` already carries both provenance facts, because B4-A insisted a
// timeline saying only "Executed" could not tell an operator whether they had
// done it or Lumi had. It publishes the two timestamps and leaves the reader to
// compare them — and the reader that does so gets it wrong (see
// memoryTimelineProvenance.test.js). The comparison belongs here, once, in the
// vocabulary both sides already share.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EXECUTION_PROVENANCE } from '@marcom/runtime-contracts';

const { decisionFindMany, decisionGroupBy } = vi.hoisted(() => ({
  decisionFindMany: vi.fn(), decisionGroupBy: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  // BOTH reads: getDecisionHistory runs findMany and groupBy under one
  // Promise.all, so mocking half of it makes the whole read fail and the
  // function correctly reports HISTORY_UNAVAILABLE — an instrument fault that
  // looks exactly like a contract failure.
  prisma: {
    decision: {
      findMany: (...a) => decisionFindMany(...a),
      groupBy:  (...a) => decisionGroupBy(...a),
    },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getDecisionHistory } from './decisionHistory.js';

const ENTITY = '11111111-1111-1111-1111-111111111111';
const row = (over = {}) => ({
  id: 'd1', entityId: ENTITY, verdict: 'KILL', status: 'PROPOSED',
  decisionClass: 'SIGNAL', createdAt: new Date('2026-08-01T00:00:00.000Z'),
  humanExecutedAt: null, platformExecutedAt: null, dismissedAt: null,
  resolution: null, confidenceDelta: null, ...over,
});

const firstEntry = async () => {
  const res = await getDecisionHistory('ws1', [ENTITY]);
  return res.byEntityId.get(ENTITY).items[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  decisionGroupBy.mockResolvedValue([{ entityId: ENTITY, _count: { _all: 1 } }]);
});

describe('C-12 · T2 — every timeline entry names its provenance', () => {
  it('a platform execution is PLATFORM', async () => {
    decisionFindMany.mockResolvedValue([row({ platformExecutedAt: new Date('2026-08-02T00:00:00.000Z') })]);
    expect((await firstEntry()).executionProvenance).toBe(EXECUTION_PROVENANCE.PLATFORM);
  });

  it('a self-report is HUMAN — a claim, never proof Lumi did anything', async () => {
    decisionFindMany.mockResolvedValue([row({ humanExecutedAt: new Date('2026-08-02T00:00:00.000Z') })]);
    expect((await firstEntry()).executionProvenance).toBe(EXECUTION_PROVENANCE.HUMAN);
  });

  it('both records is BOTH — they are independent and neither implies the other', async () => {
    decisionFindMany.mockResolvedValue([row({
      humanExecutedAt: new Date('2026-08-02T00:00:00.000Z'),
      platformExecutedAt: new Date('2026-08-03T00:00:00.000Z'),
    })]);
    expect((await firstEntry()).executionProvenance).toBe(EXECUTION_PROVENANCE.BOTH);
  });

  it('nobody acted is NONE — a real answer, not a null', async () => {
    decisionFindMany.mockResolvedValue([row()]);
    expect((await firstEntry()).executionProvenance).toBe(EXECUTION_PROVENANCE.NONE);
  });

  it('and the two raw facts still travel, so nothing is taken away', async () => {
    // The token is added BESIDE them, never instead: a consumer that needs the
    // instant still has it, and the deprecated union stays for frozen clients.
    decisionFindMany.mockResolvedValue([row({ platformExecutedAt: new Date('2026-08-02T00:00:00.000Z') })]);
    const e = await firstEntry();
    expect(e).toHaveProperty('humanExecutedAt');
    expect(e).toHaveProperty('platformExecutedAt');
    expect(e).toHaveProperty('executedAt');
  });
});
