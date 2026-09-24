// ============================================================
// AllocationEngine — cross-channel allocation correctness
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { allocate, GOAL_TYPE } from './allocationEngine.js';

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const allocateProven = (args) => allocate({
  ...args,
  channels: args.channels.map((c) => ({ ...c, currency: 'USD', monetaryStatus: 'MONETARY_VALID' })),
});

describe('allocationEngine.allocate (GROWTH_CEILING)', () => {
  it('allocates the full budget exactly (integer minor units sum to the ceiling)', () => {
    const r = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000,
      goal: { type: GOAL_TYPE.GROWTH_CEILING },
      channels: [
        { channelId: 'meta',   blendedRoas: 3.2, currentSpendMinor: 500_000, verdict: 'SCALE' },
        { channelId: 'snap',   blendedRoas: 1.8, currentSpendMinor: 300_000, verdict: 'HOLD' },
        { channelId: 'tiktok', blendedRoas: 0.9, currentSpendMinor: 200_000, verdict: 'KILL' },
      ],
    });
    expect(sum(r.allocations, (a) => a.recommendedSpendMinor)).toBe(1_000_000);
  });

  it('drains a KILL channel and favours the SCALE channel', () => {
    const r = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000,
      goal: { type: GOAL_TYPE.GROWTH_CEILING },
      channels: [
        { channelId: 'meta',   blendedRoas: 3.2, currentSpendMinor: 400_000, verdict: 'SCALE' },
        { channelId: 'tiktok', blendedRoas: 0.9, currentSpendMinor: 600_000, verdict: 'KILL' },
      ],
    });
    const meta   = r.allocations.find((a) => a.channelId === 'meta');
    const tiktok = r.allocations.find((a) => a.channelId === 'tiktok');
    expect(tiktok.deltaMinor).toBeLessThan(0);   // budget pulled out of KILL
    expect(meta.deltaMinor).toBeGreaterThan(0);  // budget pushed into SCALE
  });

  it('uses BLENDED truth: inflated platform ROAS would over-allocate vs the honest number', () => {
    const base = [
      { channelId: 'meta',   currentSpendMinor: 500_000, verdict: 'HOLD' },
      { channelId: 'snap',   currentSpendMinor: 500_000, verdict: 'HOLD' },
    ];
    const honest = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000, goal: { type: GOAL_TYPE.GROWTH_CEILING },
      channels: [{ ...base[0], blendedRoas: 3.0 }, { ...base[1], blendedRoas: 3.0 }],
    });
    const inflated = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000, goal: { type: GOAL_TYPE.GROWTH_CEILING },
      channels: [{ ...base[0], blendedRoas: 5.0 }, { ...base[1], blendedRoas: 3.0 }],
    });
    const honestMeta   = honest.allocations.find((a) => a.channelId === 'meta').recommendedSpendMinor;
    const inflatedMeta = inflated.allocations.find((a) => a.channelId === 'meta').recommendedSpendMinor;
    // A higher (inflated) ROAS pulls more budget — proving the engine keys off
    // whatever ROAS it is handed, so the caller MUST hand it blended truth.
    expect(inflatedMeta).toBeGreaterThan(honestMeta);
  });

  it('never lets a single channel exceed the maxShare cap', () => {
    const r = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000,
      goal: { type: GOAL_TYPE.GROWTH_CEILING },
      constraints: { maxShare: 0.6, maxMoveShare: 1.0 },
      channels: [
        { channelId: 'a', blendedRoas: 10, currentSpendMinor: 500_000, verdict: 'SCALE' },
        { channelId: 'b', blendedRoas: 0.1, currentSpendMinor: 500_000, verdict: 'HOLD' },
      ],
    });
    const a = r.allocations.find((x) => x.channelId === 'a');
    expect(a.recommendedSpendMinor).toBeLessThanOrEqual(600_000 + 1); // ±1 minor unit rounding
  });

  it('projects blended revenue efficiency before → after and a blended CPA', () => {
    const r = allocateProven({ totalBudgetCurrency: 'USD',
      totalBudgetMinor: 1_000_000,
      goal: { type: GOAL_TYPE.GROWTH_CEILING },
      channels: [
        { channelId: 'meta', blendedRoas: 3.0, blendedCpaMinor: 20_000, currentSpendMinor: 500_000, verdict: 'SCALE' },
        { channelId: 'snap', blendedRoas: 2.0, blendedCpaMinor: 30_000, currentSpendMinor: 500_000, verdict: 'HOLD' },
      ],
    });
    expect(r.projected.blendedRevenueEfficiencyAfter).toBeGreaterThan(0);
    expect(r.projected.projectedCpaMinor).toBeGreaterThan(0);
    expect(r.reasoningTrail.length).toBeGreaterThan(0);
  });

  it('rejects a non-positive budget and an unsupported goal', () => {
    expect(() => allocateProven({ totalBudgetMinor: 0, totalBudgetCurrency: 'USD', goal: { type: GOAL_TYPE.GROWTH_CEILING }, channels: [{ channelId: 'a', blendedRoas: 1 }] }))
      .toThrow(/totalBudgetMinor/);
    expect(() => allocateProven({ totalBudgetMinor: 100, totalBudgetCurrency: 'USD', goal: { type: 'TARGET_CAC' }, channels: [{ channelId: 'a', blendedRoas: 1 }] }))
      .toThrow(/GROWTH_CEILING/);
  });
});
