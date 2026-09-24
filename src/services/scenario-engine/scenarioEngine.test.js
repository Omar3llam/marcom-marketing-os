import { describe, it, expect } from 'vitest';
import { projectScenario } from './scenarioEngine.js';
import { SCENARIO_TYPE } from './scenarioTypes.js';

// Apparel-style baseline: Meta is the proven workhorse, TikTok is a small
// unproven channel. Money in minor units (USD cents). AOV $50, 60% margin.
const baseline = [
  { channelId: 'meta',   channel: 'META',   spendMinor: 1_000_000, blendedRoas: 3.0, currency: 'USD' },
  { channelId: 'google', channel: 'GOOGLE', spendMinor:   600_000, blendedRoas: 2.5, currency: 'USD' },
  { channelId: 'tiktok', channel: 'TIKTOK', spendMinor:   100_000, blendedRoas: 2.0, currency: 'USD' },
];
const economics = { aovMinor: 5_000, grossMarginPct: 0.6, currency: 'USD' };
const memoryHigh = [{ cohort: 'EG-apparel', accuracy: 0.9 }];
const memoryLow  = [{ cohort: 'EG-apparel', accuracy: 0.5 }];

function isRange(r) {
  return r && typeof r.low === 'number' && typeof r.expected === 'number' && typeof r.high === 'number';
}

describe('projectScenario — honesty: every projection is a range', () => {
  it('reallocation yields low<expected<high for CAC and volume', () => {
    const out = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.CHANNEL_REALLOCATION, shifts: [{ fromChannelId: 'meta', toChannelId: 'tiktok', pct: 0.2 }] },
      economics, memory: memoryHigh,
    });
    expect(out.scenarioType).toBe(SCENARIO_TYPE.CHANNEL_REALLOCATION);
    for (const key of ['blendedCacMinor', 'volume', 'revenueMinor', 'grossProfitMinor', 'blendedRevenueEfficiencyAfter']) {
      expect(isRange(out.projections[key])).toBe(true);
    }
    expect(out.projections.blendedCacMinor.low).toBeLessThan(out.projections.blendedCacMinor.high);
    expect(out.projections.volume.low).toBeLessThan(out.projections.volume.high);
  });

  it('carries at least 3 named assumptions', () => {
    const out = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.CHANNEL_REALLOCATION, shifts: [{ fromChannelId: 'meta', toChannelId: 'tiktok', pct: 0.2 }] },
      economics, memory: memoryHigh,
    });
    expect(out.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(out.assumptions.join(' ')).toMatch(/retains/);
  });

  it('lower memory accuracy widens the band', () => {
    const args = { baseline, change: { type: SCENARIO_TYPE.BUDGET_EXPANSION, deltaPct: 0.5 }, economics };
    const wide  = projectScenario({ ...args, memory: memoryLow });
    const tight = projectScenario({ ...args, memory: memoryHigh });
    const span = (o) => o.projections.revenueMinor.high - o.projections.revenueMinor.low;
    expect(span(wide)).toBeGreaterThan(span(tight));
  });
});

describe('projectScenario — the CEO lens (revenue + gross profit)', () => {
  it('+50% expansion: revenue and gross profit rise even as CAC degrades at the pessimistic end', () => {
    const out = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.BUDGET_EXPANSION, deltaPct: 0.5 },
      economics, memory: memoryHigh,
    });
    const base = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.BUDGET_EXPANSION, deltaPct: 0 }, // degenerate = baseline
      economics, memory: memoryHigh,
    });
    // More spend → more revenue + profit.
    expect(out.projections.revenueMinor.expected).toBeGreaterThan(base.projections.revenueMinor.expected);
    expect(out.projections.grossProfitMinor.expected).toBeGreaterThan(base.projections.grossProfitMinor.expected);
    // Added budget buys worse efficiency → CAC at the pessimistic (high) end
    // is worse than today's baseline CAC.
    expect(out.projections.blendedCacMinor.high).toBeGreaterThan(base.projections.blendedCacMinor.expected);
    // The basis surfaces the trade-off honestly.
    expect(out.basis).toMatch(/profit better/i);
  });

  it('contraction holds CAC roughly flat (removes worst units first)', () => {
    const out = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.BUDGET_CONTRACTION, deltaPct: -0.3 },
      economics, memory: memoryHigh,
    });
    const base = projectScenario({
      baseline, change: { type: SCENARIO_TYPE.BUDGET_CONTRACTION, deltaPct: 0 },
      economics, memory: memoryHigh,
    });
    // CAC = AOV/ROAS; trimming at average efficiency keeps expected CAC equal.
    expect(out.projections.blendedCacMinor.expected).toBe(base.projections.blendedCacMinor.expected);
    // Less spend → less revenue.
    expect(out.projections.revenueMinor.expected).toBeLessThan(base.projections.revenueMinor.expected);
  });
});

describe('projectScenario — degenerate + determinism', () => {
  it('zero-change reallocation collapses to a labeled point', () => {
    const out = projectScenario({
      baseline,
      change: { type: SCENARIO_TYPE.CHANNEL_REALLOCATION, shifts: [] },
      economics, memory: [{ accuracy: 1.0 }], // accuracy 1 ⇒ no widening
    });
    const r = out.projections.blendedCacMinor;
    expect(r.low).toBe(r.expected);
    expect(r.expected).toBe(r.high);
  });

  it('is deterministic', () => {
    const args = {
      baseline,
      change: { type: SCENARIO_TYPE.BUDGET_EXPANSION, deltaPct: 0.4 },
      economics, memory: memoryLow,
    };
    expect(projectScenario(args)).toEqual(projectScenario(args));
  });

  it('rejects invalid economics', () => {
    expect(() => projectScenario({
      baseline, change: { type: SCENARIO_TYPE.BUDGET_EXPANSION, deltaPct: 0.1 },
      economics: { aovMinor: 0, grossMarginPct: 0.6 },
    })).toThrow(/aovMinor/);
  });
});
