// ============================================================
// C-10 · THE LOCK — a verdict is only readable inside its own class
// ------------------------------------------------------------
// `buildChannels` reads "the latest verdict per channel entity" to gate budget
// appetite:
//
//   where:   { workspaceId, entityId: { in: channels.map((c) => c.channelId) } }
//   orderBy: { createdAt: 'desc' }
//
// `channelId` is `MetricSnapshot.entityId` — the SAME entity ids Decisions are
// written against. So under a standing breach the newest row for that entity is
// a GuardrailSweepService episode, written every 15 minutes, and it becomes what
// the allocation engine calls "the channel's verdict":
//
//   VERDICT_APPETITE.KILL = 0.0   →  the channel is drained to zero
//   rationale published as         "Drain <ch>: KILL verdict — pull budget out."
//
// The KILL is a POLICY BREACH EPISODE. It is not the connector's judgement of
// that channel's performance, and the sentence the strategist reads says it is.
//
//   SIGNAL KILL ≠ GUARDRAIL KILL, even when the word is identical.
//
// And C-18 raised the price: the approved mix is now executed verbatim, so a
// wrong appetite gate is frozen into the plan snapshot and promoted exactly.
//
// ── Why the prisma mock FILTERS ─────────────────────────────────────────────
// A mock that returned a fixed array regardless of `where` would pass under any
// implementation and prove nothing. This one behaves like the database: it
// applies the predicate it is handed. So the test fails today because the query
// carries no class predicate, and passes only when the query itself is scoped.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany: (...a) => findMany(...a) } } }));
// Spend-window slice: previewAllocation now reads the period's spend through
// spendPeriod, which uses BlendedTruth's own latestPerStream — so the real module
// is kept and only getBlendedTruth is replaced. The appetite gate is exercised on
// a MEASURED period, because an unmeasured one sizes nothing at all.
vi.mock('../budget-period/spendPeriod.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPeriodSpend: vi.fn(async (_workspaceId, { period } = {}) => ({
    portfolio: { status: 'MEASURABLE', reason: null, period, window: period, daysCovered: 31, spendMinor: 1_000_000, currency: 'USD', monetaryStatus: 'MONETARY_VALID' },
    byEntity: new Map([['camp-a', 500_000], ['camp-b', 500_000]]),
  })),
}));
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(async () => ({
    channels: [
      { channelId: 'camp-a', channel: 'META',   blendedRoas: 3.0, spendMinor: 500_000, blendedRevenueMinor: 1_500_000, currency: 'USD', monetaryStatus: 'MONETARY_VALID' },
      { channelId: 'camp-b', channel: 'GOOGLE', blendedRoas: 2.5, spendMinor: 500_000, blendedRevenueMinor: 1_250_000, currency: 'USD', monetaryStatus: 'MONETARY_VALID' },
    ],
  })),
}));

import { previewAllocation } from './AllocationService.js';
import { DECISION_CLASS } from '@marcom/runtime-contracts';

// The rows a real workspace holds: a healthy connector verdict on camp-a, and a
// guardrail episode written LATER because the sweep runs every 15 minutes.
const ROWS = [
  {
    id: 'd-guard', entityId: 'camp-a', verdict: 'KILL',
    decisionClass: DECISION_CLASS.GUARDRAIL, rootCause: 'guardrail:Frequency ceiling',
    createdAt: new Date('2026-09-04T12:00:00Z'),
  },
  {
    id: 'd-signal', entityId: 'camp-a', verdict: 'SCALE',
    decisionClass: DECISION_CLASS.SIGNAL, rootCause: 'CREATIVE_FATIGUE',
    createdAt: new Date('2026-09-04T09:00:00Z'),
  },
];

/** A findMany that honours `entityId.in` and `decisionClass.in`, like the DB. */
function databaseLike(rows) {
  return async ({ where = {}, orderBy }) => {
    let out = rows.filter((r) => {
      const ids = where.entityId?.in;
      if (ids && !ids.includes(r.entityId)) return false;
      const classes = where.decisionClass?.in;
      if (classes && !classes.includes(r.decisionClass)) return false;
      return true;
    });
    if (orderBy?.createdAt === 'desc') out = [...out].sort((a, b) => b.createdAt - a.createdAt);
    return out;
  };
}

const allocationFor = (plan, id) => plan.allocations.find((a) => a.channelId === id);

beforeEach(() => {
  findMany.mockReset();
});

describe('T6 — a GUARDRAIL KILL cannot reach the appetite gate as a Signal KILL', () => {
  it('the appetite read declares the classes it accepts', () => {
    findMany.mockImplementation(databaseLike(ROWS));
    return previewAllocation('ws1', { totalBudgetMinor: 1_000_000, totalBudgetCurrency: 'USD' }).then(() => {
      const { where } = findMany.mock.calls[0][0];
      // Not "there happens to be a filter" — the reader must NAME what it takes.
      expect(where.decisionClass).toEqual({ in: [DECISION_CLASS.SIGNAL] });
    });
  });

  it('does not drain a channel whose only KILL is a policy breach', async () => {
    findMany.mockImplementation(databaseLike(ROWS));

    const plan = await previewAllocation('ws1', { totalBudgetMinor: 1_000_000, totalBudgetCurrency: 'USD' });
    const a = allocationFor(plan, 'camp-a');

    // The connector's live judgement on camp-a is SCALE. The guardrail episode
    // says a frequency ceiling was breached — a fact about policy, and not an
    // instruction to withdraw the budget.
    expect(a.verdict).toBe('SCALE');
    expect(a.recommendedSpendMinor).toBeGreaterThan(0);
  });

  it('never publishes a KILL rationale sourced from a breach episode', async () => {
    findMany.mockImplementation(databaseLike(ROWS));

    const plan = await previewAllocation('ws1', { totalBudgetMinor: 1_000_000, totalBudgetCurrency: 'USD' });

    // The exact sentence the strategist reads, and the one C-18 now freezes into
    // the approved snapshot and promotes verbatim.
    expect(plan.reasoningTrail.join('\n')).not.toMatch(/Drain camp-a/);
  });
});

describe("T7 — allocation's own previous move cannot feed the next appetite read", () => {
  const WITH_OWN_OUTPUT = [
    {
      id: 'd-alloc', entityId: 'camp-a', verdict: 'REALLOCATE',
      decisionClass: DECISION_CLASS.ALLOCATION, rootCause: 'allocation:plan-1',
      createdAt: new Date('2026-09-04T13:00:00Z'),
    },
    ROWS[1], // the SIGNAL SCALE, older
  ];

  it('reads its own REALLOCATE rows out of the population', async () => {
    findMany.mockImplementation(databaseLike(WITH_OWN_OUTPUT));

    const plan = await previewAllocation('ws1', { totalBudgetMinor: 1_000_000 });
    const a = allocationFor(plan, 'camp-a');

    // On trunk the newest row wins, so the previous plan's own output becomes an
    // input to the next one: REALLOCATE carries appetite 0.5 and damps the very
    // channel the last plan moved budget into. A closed loop with no evidence
    // in it — the engine reading its own echo as a finding about the account.
    expect(a.verdict).toBe('SCALE');
  });

  it('holds the honest default when a channel has no Signal verdict at all', async () => {
    // Only a guardrail row exists for camp-a. The correct answer is not "KILL"
    // and not "SCALE" — it is that no verdict was reached, which the engine
    // already spells HOLD. The default survives; what changes is that it is now
    // reached because the class was settled first, not because a foreign row
    // happened to be missing.
    findMany.mockImplementation(databaseLike([ROWS[0]]));

    const plan = await previewAllocation('ws1', { totalBudgetMinor: 1_000_000 });
    expect(allocationFor(plan, 'camp-a').verdict).toBe('HOLD');
  });
});
