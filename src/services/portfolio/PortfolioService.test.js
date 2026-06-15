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
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { allocationPlan: { findFirst: vi.fn() } },
}));

import { getPortfolio } from './PortfolioService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PortfolioService.getPortfolio — guards', () => {
  it('requires a workspaceId', async () => {
    await expect(getPortfolio()).rejects.toThrow(/workspaceId/);
  });
});

describe('PortfolioService.getPortfolio — empty workspace is honest', () => {
  it('no channels + no plan → null budget, null pacing, no channels (never a fabricated burn)', async () => {
    getBlendedTruth.mockResolvedValue(bt([]));
    prisma.allocationPlan.findFirst.mockResolvedValue(null);

    const view = await getPortfolio('ws1', { now: NOW });

    expect(view.monthlyBudgetMinor).toBeNull();
    expect(view.pacing).toBeNull();
    expect(view.channels).toEqual([]);
    expect(view.totals.spendMinor).toBe(0);
    expect(view.totals.blendedRoas).toBe(0);
  });

  it('channels present but no budget resolvable → still null pacing on portfolio AND every channel', async () => {
    getBlendedTruth.mockResolvedValue(bt([
      { channelId: 'a', channel: 'META', spendMinor: 60_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 40_000 },
    ]));
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
    getBlendedTruth.mockResolvedValue(bt([
      { channelId: 'a', channel: 'META', spendMinor: 600_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 400_000 },
    ]));

    const view = await getPortfolio('ws1', { monthlyBudgetMinor: 1_000_000, now: NOW });

    expect(view.monthlyBudgetMinor).toBe(1_000_000);
    expect(prisma.allocationPlan.findFirst).not.toHaveBeenCalled(); // override short-circuits the lookup
    expect(view.pacing).not.toBeNull();
    expect(view.pacing.projectedSpendMinor).toBe(2_000_000);
    expect(view.pacing.status).toBe('OVER');
  });

  it('per-channel pacing splits the budget by current spend share', async () => {
    getBlendedTruth.mockResolvedValue(bt([
      { channelId: 'a', channel: 'META', spendMinor: 600_000 },
      { channelId: 'b', channel: 'GOOGLE', spendMinor: 400_000 },
    ]));

    const view = await getPortfolio('ws1', { monthlyBudgetMinor: 1_000_000, now: NOW });

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
    getBlendedTruth.mockResolvedValue(bt([
      { channelId: 'a', channel: 'META', spendMinor: 100_000 },
    ]));
    prisma.allocationPlan.findFirst.mockResolvedValue({ totalBudgetMinor: 500_000 });

    const view = await getPortfolio('ws1', { now: NOW });

    expect(prisma.allocationPlan.findFirst).toHaveBeenCalledOnce();
    expect(view.monthlyBudgetMinor).toBe(500_000);
    expect(view.pacing).not.toBeNull();
  });
});
