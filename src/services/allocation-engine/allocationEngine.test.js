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

describe('P7-07G: money stays in structured moves, not rationale', () => {
  const channel = (channelId, blendedRoas, verdict = 'HOLD') => ({
    channelId, channel: channelId, blendedRoas, verdict,
    currentSpendMinor: 50_000, currentRevenueMinor: 50_000 * blendedRoas,
    currency: 'EGP', monetaryStatus: 'MONETARY_VALID',
  });
  const plan = (totalBudgetMinor, channels = [channel('Meta', 3), channel('Google', 1)]) =>
    allocate({ totalBudgetMinor, totalBudgetCurrency: 'EGP', channels });

  it.each([
    [150_000, 105_000, 55_000, 45_000, -5_000, 360_000, 'Grow'],
    [50_000, 35_000, -15_000, 15_000, -35_000, 120_000, 'Trim'],
    [3_544_286, 2_481_000, 2_431_000, 1_063_286, 1_013_286, 8_506_286, 'Grow'],
  ])('keeps exact amounts/projections for budget %i but publishes amount-free reasoning',
    (total, metaBudget, metaDelta, googleBudget, googleDelta, revenue, direction) => {
      const result = plan(total);
      expect(result).toMatchObject({ totalBudgetMinor: total, currency: 'EGP',
        allocations: [
          { currentSpendMinor: 50_000, recommendedSpendMinor: metaBudget, deltaMinor: metaDelta },
          { currentSpendMinor: 50_000, recommendedSpendMinor: googleBudget, deltaMinor: googleDelta },
        ],
        projected: { blendedRevenueMinor: revenue, projectedCpaMinor: null,
          blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: revenue / total },
      });
      const sentences = [
        `${direction} Meta (HOLD, blended revenue efficiency 3.00x).`,
        `${googleDelta > 0 ? 'Grow' : 'Trim'} Google (HOLD, blended revenue efficiency 1.00x).`,
      ];
      expect(result.allocations.map(move => move.rationale)).toEqual(sentences);
      expect(result.reasoningTrail.slice(1)).toEqual(sentences);
      for (const rationale of result.allocations.map(move => move.rationale)) {
        expect(rationale).not.toMatch(/\bby\b|EGP|USD|AED|[€$£]/);
        for (const amount of [50_000, metaBudget, Math.abs(metaDelta), googleBudget, Math.abs(googleDelta), total]) {
          expect(rationale).not.toContain(String(amount));
          expect(rationale).not.toContain((amount / 100).toFixed(2));
        }
      }
    });

  it('preserves actual REALLOCATE input and its efficiency explanation', () => {
    const result = plan(50_000, [channel('Meta', 3), channel('Google', 1.4, 'REALLOCATE')]);
    const move = result.allocations[1];
    expect(move.deltaMinor).toBeLessThan(0);
    expect(move.rationale).toBe('Trim Google (REALLOCATE, blended revenue efficiency 1.40x).');
    expect(result.reasoningTrail[2]).toBe(move.rationale);
  });

  it('preserves genuine zero moves without introducing an amount into hold reasoning', () => {
    const result = plan(100_000, [channel('Meta', 2), channel('Google', 2)]);
    expect(result.allocations.map(({ currentSpendMinor, recommendedSpendMinor, deltaMinor }) =>
      ({ currentSpendMinor, recommendedSpendMinor, deltaMinor }))).toEqual([
      { currentSpendMinor: 50_000, recommendedSpendMinor: 50_000, deltaMinor: 0 },
      { currentSpendMinor: 50_000, recommendedSpendMinor: 50_000, deltaMinor: 0 },
    ]);
    expect(result.allocations.map(move => move.rationale)).toEqual([
      'Hold Meta: already near its efficient share.', 'Hold Google: already near its efficient share.',
    ]);
    expect(result.reasoningTrail.slice(1)).toEqual(result.allocations.map(move => move.rationale));
  });

  it('preserves the KILL explanation and structured budget drain', () => {
    const result = plan(100_000, [channel('Meta', 3), channel('Google', 1, 'KILL')]);
    expect(result.allocations[1]).toMatchObject({ currentSpendMinor: 50_000,
      recommendedSpendMinor: 30_000, deltaMinor: -20_000,
      rationale: 'Drain Google: KILL verdict — pull budget out.' });
    expect(result.reasoningTrail[2]).toBe(result.allocations[1].rationale);
  });
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
