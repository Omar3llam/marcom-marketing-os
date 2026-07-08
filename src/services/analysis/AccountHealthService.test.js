// ============================================================
// AccountHealthService — deterministic analysis (pure, no mocks)
// ------------------------------------------------------------
// Pins the three calculations to concrete rows: honest nulls, spend-weighted
// health, KILL+REFRESH wasted spend, spend-share impact, the CTR fraction→percent
// conversion, and the currency-relative (1%) spend floor.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  computeAccountHealth,
  verdictToHealthScore,
  computeImpactScore,
  healthLabel,
} from './AccountHealthService.js';

// A connector row carries CTR as a FRACTION (0.0185 = 1.85%), spend in minor units.
const row = (over = {}) => ({
  entityId: 'c', name: 'C', spendMinor: 10000, ctr: 0.015, frequency: 1.0, roas: 2.0, ...over,
});

describe('computeAccountHealth — honest nulls', () => {
  it('returns null when there are no campaigns', () => {
    expect(computeAccountHealth([], {})).toBeNull();
    expect(computeAccountHealth(null, {})).toBeNull();
  });

  it('returns null when total spend is 0 (never a fabricated 0 score)', () => {
    const campaigns = [row({ entityId: 'a', spendMinor: 0 }), row({ entityId: 'b', spendMinor: null })];
    expect(computeAccountHealth(campaigns, {})).toBeNull();
  });

  it('returns null when every campaign is below the scoring floor of engagement signal', () => {
    // Spend exists, but no CTR and no frequency anywhere → nothing to score.
    const campaigns = [row({ entityId: 'a', ctr: 0, frequency: null })];
    expect(computeAccountHealth(campaigns, { a: { verdict: 'HOLD' } })).toBeNull();
  });
});

describe('computeAccountHealth — wasted spend = KILL + REFRESH', () => {
  it('sums spend on KILL and REFRESH campaigns, as a minor total + pct of account', () => {
    const campaigns = [
      row({ entityId: 'k', spendMinor: 20000 }),
      row({ entityId: 'r', spendMinor: 15000 }),
      row({ entityId: 'h', spendMinor: 65000 }),
    ];
    const verdictMap = { k: { verdict: 'KILL' }, r: { verdict: 'REFRESH' }, h: { verdict: 'HOLD' } };
    const out = computeAccountHealth(campaigns, verdictMap);
    expect(out.wastedSpend.minor).toBe(35000);   // 20000 + 15000
    expect(out.wastedSpend.pct).toBe(35);         // of 100000
  });

  it('excludes REALLOCATE — moved budget is not wasted budget', () => {
    const campaigns = [
      row({ entityId: 'x', spendMinor: 50000 }),
      row({ entityId: 'y', spendMinor: 50000 }),
    ];
    const out = computeAccountHealth(campaigns, { x: { verdict: 'REALLOCATE' }, y: { verdict: 'SCALE' } });
    expect(out.wastedSpend.minor).toBe(0);
    expect(out.wastedSpend.pct).toBe(0);
  });

  it('counts a sub-floor KILL campaign as wasted even though it is not scored', () => {
    const campaigns = [
      row({ entityId: 'big', spendMinor: 99500, ctr: 0.02, frequency: 1 }),
      row({ entityId: 'tiny', spendMinor: 500 }), // 0.5% < 1% floor
    ];
    const out = computeAccountHealth(campaigns, { big: { verdict: 'HOLD' }, tiny: { verdict: 'KILL' } });
    expect(out.wastedSpend.minor).toBe(500);      // wasted counts every campaign
    expect(out.campaigns.map((c) => c.entityId)).not.toContain('tiny'); // scoring skips it
    expect(out.campaigns.map((c) => c.entityId)).toContain('big');
  });
});

describe('computeAccountHealth — account health is spend-weighted', () => {
  it('weights a big healthy campaign above a small killed one (not a plain mean)', () => {
    const campaigns = [
      row({ entityId: 's', spendMinor: 80000 }),
      row({ entityId: 'k', spendMinor: 20000 }),
    ];
    const out = computeAccountHealth(campaigns, { s: { verdict: 'SCALE' }, k: { verdict: 'KILL' } });
    // (85*0.8 + 10*0.2) = 70, NOT the plain mean of 47.5.
    expect(out.score).toBe(70);
    expect(out.label).toBe('GOOD');
  });

  it('an unknown/absent verdict scores neutral (50), never a guess', () => {
    const out = computeAccountHealth([row({ entityId: 'u', spendMinor: 100000 })], {}); // no verdict
    expect(out.score).toBe(50);
    expect(out.label).toBe('FAIR');
  });
});

describe('computeAccountHealth — CTR fraction → percent conversion', () => {
  it('reads 0.025 as 2.5% (strong hook +5), not 0.025% (weak hook -10)', () => {
    const out = computeAccountHealth(
      [row({ entityId: 'c', spendMinor: 100000, ctr: 0.025, frequency: 1.0 })],
      { c: { verdict: 'SCALE' } },
    );
    // SCALE 85 + strong-CTR bonus 5 = 90. Without ×100 it would be 85 - 10 = 75.
    expect(out.score).toBe(90);
  });
});

describe('computeImpactScore — verdict severity × spend share', () => {
  it('KILL with a dominant spend share and bleeding ROAS → top of the range (8-10)', () => {
    expect(computeImpactScore({ verdict: 'KILL', spendShare: 1.0, roas: 0.5 })).toBe(10);
    expect(computeImpactScore({ verdict: 'KILL', spendShare: 0.5, roas: 2.0 })).toBe(9);
  });

  it('SCALE with a small spend share → bottom of the range (1-3)', () => {
    expect(computeImpactScore({ verdict: 'SCALE', spendShare: 0.05, roas: 3.0 })).toBe(1);
    expect(computeImpactScore({ verdict: 'SCALE', spendShare: 0.5, roas: 3.0 })).toBeLessThanOrEqual(3);
  });

  it('is exhaustive over the verdict vocabulary (REALLOCATE included, no NaN)', () => {
    for (const v of ['KILL', 'HOLD', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH', null]) {
      const s = computeImpactScore({ verdict: v, spendShare: 0.3, roas: 2 });
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(10);
    }
  });
});

describe('verdictToHealthScore — fatigue + hook adjustments, clamped', () => {
  it('penalizes heavy frequency and weak CTR, clamped to [0,100]', () => {
    expect(verdictToHealthScore('KILL', 0.3, 4.0)).toBe(0);   // 10 - 10 (freq) - 10 (ctr) → clamp 0
    expect(verdictToHealthScore('SCALE', 2.5, 1.0)).toBe(90); // 85 + 5
    expect(verdictToHealthScore('SCALE', 1.5, 1.0)).toBe(85); // neutral CTR band
  });
});

describe('healthLabel — boundaries', () => {
  it('maps score bands to labels', () => {
    expect(healthLabel(85)).toBe('HEALTHY');
    expect(healthLabel(70)).toBe('GOOD');
    expect(healthLabel(50)).toBe('FAIR');
    expect(healthLabel(30)).toBe('NEEDS ATTENTION');
    expect(healthLabel(10)).toBe('CRITICAL');
  });
});

describe('computeAccountHealth — per-campaign impact surfaced for the table', () => {
  it('returns { entityId, impactScore, verdict } for each scored campaign', () => {
    const out = computeAccountHealth(
      [row({ entityId: 'a', spendMinor: 100000 })],
      { a: { verdict: 'KILL', roas: 0.5 } },
    );
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({ entityId: 'a', verdict: 'KILL' });
    expect(out.campaigns[0].impactScore).toBeGreaterThanOrEqual(1);
    expect(out.campaigns[0].impactScore).toBeLessThanOrEqual(10);
  });
});
