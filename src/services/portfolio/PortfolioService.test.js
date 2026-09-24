// ============================================================
// PortfolioService — composition correctness (budget · pacing · share)
// ============================================================
// Proves the service's COMPOSITION logic, not the engines it composes
// (blended-truth + pacing are tested in their own suites). The DB seam
// (getBlendedTruth + the latest AllocationPlan lookup) is mocked; the
// real pacingEngine runs so the pacing assertions are end-to-end honest.
// Governing law: an empty workspace yields null budget / null pacing —
// never a fabricated burn projection.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Spend-window slice: pacing no longer reads the blended total. It reads spend
// whose DECLARED window is this month to date, through spendPeriod — mocked here
// so this file keeps proving COMPOSITION (budget · pacing · share). Whether a
// window qualifies is pinned in src/tests/spendWindowIntegrity.pacing.red.test.js.
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
vi.mock('../budget-period/spendPeriod.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPeriodSpend: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { allocationPlan: { findFirst: vi.fn() } },
}));

import { getPortfolio } from './PortfolioService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { readPeriodSpend } from '../budget-period/spendPeriod.js';
import { prisma } from '../../lib/prisma.js';

// Mid-month UTC clock: June 2026 → 30 days, day 15 elapsed (half the period).
const NOW = new Date(Date.UTC(2026, 5, 15));

// A blended-truth result whose portfolio.spendMinor is the sum of channel spend.
function bt(channels, portfolioOverrides = {}) {
  const spendMinor = channels.reduce((s, c) => s + c.spendMinor, 0);
  return {
    channels,
    portfolio: {
      spendMinor,
      platformRevenueMinor: 0,
      blendedRevenueMinor: 0,
      blendedRoas: 0,
      platformRoas: 0,
      gapMinor: 0,
      gapPct: 0,
      reconciledCount: 0,
      unverifiedCount: 0,
      ...portfolioOverrides,
    },
  };
}

/**
 * Month-to-date spend over June 1–15 — the same rows `bt()` describes, now with
 * the window they cover stated. 15 of 30 days, so the old half-period arithmetic
 * below is unchanged: it is the SOURCE of the spend that moved.
 */
function measuredMtd(channels) {
  const byEntity = new Map(channels.map((c) => [c.channelId, c.spendMinor]));
  const spendMinor = channels.reduce((s, c) => s + c.spendMinor, 0);
  return {
    portfolio: {
      status: 'MEASURABLE', reason: null, period: { start: '2026-06-01', end: '2026-06-30' },
      window: { start: '2026-06-01', end: '2026-06-15' }, daysCovered: 15, spendMinor,
      currency: 'USD', monetaryStatus: 'MONETARY_VALID', monetaryReason: null,
    },
    byEntity,
  };
}

const NOTHING_MEASURED = {
  portfolio: {
    status: 'NOT_MEASURABLE', reason: 'NO_SPEND_ROWS', period: { start: '2026-06-01', end: '2026-06-30' },
    window: null, daysCovered: null, spendMinor: null,
  },
  byEntity: new Map(),
};

/** One set of channels, fed to BOTH reads so the two can never disagree in a fixture. */
function seat(channels) {
  getBlendedTruth.mockResolvedValue(bt(channels));
  readPeriodSpend.mockResolvedValue(channels.length ? measuredMtd(channels) : NOTHING_MEASURED);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PortfolioService.getPortfolio — guards', () => {
  it('requires a workspaceId', async () => {
    await expect(getPortfolio()).rejects.toThrow(/workspaceId/);
  });
});

describe('PortfolioService.getPortfolio — empty workspace is honest', () => {
  it('Home strict budget read distinguishes a failed lookup from no allocation plan', async () => {
    seat([]);
    const failure = new Error('private allocation read failure');
    prisma.allocationPlan.findFirst.mockRejectedValue(failure);
    await expect(getPortfolio('ws1', { now: NOW, strictBudgetRead: true })).rejects.toBe(failure);
    expect(readPeriodSpend).not.toHaveBeenCalled();
  });

  it('Home strict budget read accepts genuine absence', async () => {
    seat([]);
    prisma.allocationPlan.findFirst.mockResolvedValue(null);
    const view = await getPortfolio('ws1', { now: NOW, strictBudgetRead: true });
    expect(view.monthlyBudgetMinor).toBeNull();
    expect(view.pacing).toBeNull();
  });

  it('other callers retain their existing best-effort budget behavior', async () => {
    seat([]);
    prisma.allocationPlan.findFirst.mockRejectedValue(new Error('budget unavailable'));
    const view = await getPortfolio('ws1', { now: NOW });
    expect(view.monthlyBudgetMinor).toBeNull();
    expect(view.pacing).toBeNull();
  });

  it('no channels + no plan → null budget, null pacing, no channels (never a fabricated burn)', async () => {
    seat([]);
    prisma.allocationPlan.findFirst.mockResolvedValue(null);

    const view = await getPortfolio('ws1', { now: NOW });

    expect(view.monthlyBudgetMinor).toBeNull();
    expect(view.pacing).toBeNull();
    expect(view.channels).toEqual([]);
    expect(view.totals.spendMinor).toBe(0);
    expect(view.totals.blendedRoas).toBe(0);
  });

  it('channels present but no budget resolvable → still null pacing on portfolio AND every channel', async () => {
    seat([
      { channelId: 'a', channel: 'META', spendMinor: 60_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 40_000 },
    ]);
    prisma.allocationPlan.findFirst.mockResolvedValue(null); // no plan, no override

    const view = await getPortfolio('ws1', { now: NOW });

    expect(view.monthlyBudgetMinor).toBeNull();
    expect(view.pacing).toBeNull();
    expect(view.channels.every((c) => c.pacing === null)).toBe(true);
  });
});

describe('PortfolioService.getPortfolio — budget resolution', () => {
  it('an explicit monthlyBudgetMinor override drives real pacing (over-pace detected end-to-end)', async () => {
    // 1,000,000 spent at day 15/30 → projected 2,000,000 → paceRatio 2 → OVER.
    seat([
      { channelId: 'a', channel: 'META', spendMinor: 600_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 400_000 },
    ]);

    const view = await getPortfolio('ws1', { monthlyBudgetMinor: 1_000_000, monthlyBudgetCurrency: 'USD', now: NOW });

    expect(view.monthlyBudgetMinor).toBe(1_000_000);
    expect(prisma.allocationPlan.findFirst).not.toHaveBeenCalled(); // override short-circuits the lookup
    expect(view.pacing).not.toBeNull();
    expect(view.pacing.projectedSpendMinor).toBe(2_000_000);
    expect(view.pacing.status).toBe('OVER');
  });

  it('per-channel pacing splits the budget by current spend share', async () => {
    seat([
      { channelId: 'a', channel: 'META', spendMinor: 600_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 400_000 },
    ]);

    const view = await getPortfolio('ws1', { monthlyBudgetMinor: 1_000_000, monthlyBudgetCurrency: 'USD', now: NOW });

    const a = view.channels.find((c) => c.channelId === 'a');
    const b = view.channels.find((c) => c.channelId === 'b');
    // Each channel keeps its source fields AND gains a real pacing projection.
    expect(a.pacing).not.toBeNull();
    expect(b.pacing).not.toBeNull();
    // 60% share of 1,000,000 → 600,000 budget; spent 600,000 at half-period
    // → projected 1,200,000 → OVER. The split is by spend share, so both over-pace.
    expect(a.pacing.projectedSpendMinor).toBe(1_200_000);
    expect(b.pacing.projectedSpendMinor).toBe(800_000);
  });

  it('falls back to the latest AllocationPlan budget when no override is given', async () => {
    seat([
      { channelId: 'a', channel: 'META', spendMinor: 100_000 },
    ]);
    prisma.allocationPlan.findFirst.mockResolvedValue({ totalBudgetMinor: 500_000, currency: 'USD' });

    const view = await getPortfolio('ws1', { now: NOW });

    expect(prisma.allocationPlan.findFirst).toHaveBeenCalledOnce();
    expect(view.monthlyBudgetMinor).toBe(500_000);
    expect(view.pacing).not.toBeNull();
  });
});
