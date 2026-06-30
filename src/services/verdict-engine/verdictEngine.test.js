// ============================================================
// VerdictEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { evaluateVerdict, rollupVerdicts, aggregateMetrics } from './verdictEngine.js';
import { VERDICT, verdictToActionType }                       from './verdictTypes.js';

// Build a leaf creative node with full metrics.
function creative(id, { spendMinor, revenueMinor, impressions, clicks, conversions, frequency }) {
  return { id, level: 'CREATIVE', metrics: { spendMinor, revenueMinor, impressions, clicks, conversions, frequency } };
}

describe('evaluateVerdict — single entity', () => {
  it('returns KILL when losing money and saturated', () => {
    const metrics = { ctr: 0.4, cpc: 2, cpm: 10, frequency: 4.2, spend: 1000, conversions: 2, roas: 0.6 };
    const r = evaluateVerdict({ level: 'ADSET', metrics });
    expect(r.verdict).toBe(VERDICT.KILL);
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('returns REFRESH on creative fatigue (high freq, low ctr, but still profitable)', () => {
    // frequency>3 & ctr<1 → CREATIVE_FATIGUE, roas healthy so not KILL
    const metrics = { ctr: 0.8, cpc: 1, cpm: 8, frequency: 3.2, spend: 500, conversions: 30, roas: 2.5 };
    const r = evaluateVerdict({ level: 'ADSET', metrics });
    expect(r.verdict).toBe(VERDICT.REFRESH);
    expect(r.recommendationTypes).toContain('REFRESH_CREATIVE');
  });

  it('returns SCALE on a strong healthy performer', () => {
    const metrics = { ctr: 2.5, cpc: 0.5, cpm: 5, frequency: 1.4, spend: 500, conversions: 60, roas: 4.2 };
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics });
    expect(r.verdict).toBe(VERDICT.SCALE);
  });

  it('returns HOLD on a healthy-but-unremarkable entity', () => {
    const metrics = { ctr: 1.8, cpc: 0.9, cpm: 5, frequency: 1.5, spend: 80, conversions: 6, roas: 1.8 };
    const r = evaluateVerdict({ level: 'ADSET', metrics });
    expect(r.verdict).toBe(VERDICT.HOLD);
  });

  it('raises HOLD to WATCH when a guardrail hit is present', () => {
    const metrics = { ctr: 1.8, cpc: 0.9, cpm: 5, frequency: 1.5, spend: 80, conversions: 6, roas: 1.8 };
    const r = evaluateVerdict({ level: 'ADSET', metrics, guardrailHits: [{ rationale: 'CPA +50% for 2d' }] });
    expect(r.verdict).toBe(VERDICT.WATCH);
  });

  it('throws without metrics', () => {
    expect(() => evaluateVerdict({ level: 'ADSET' })).toThrow('metrics is required');
  });
});

describe('evaluateVerdict — awareness track (revenueMeasured: false, roas null)', () => {
  // Awareness/reach campaigns measure engagement, not revenue. The engine must
  // judge them on frequency + CTR and NEVER emit a revenue verdict (KILL/SCALE).
  const aware = (over) => ({ ctr: 1.5, cpc: 0, cpm: 5, frequency: 1.4, spend: 500, conversions: 0, roas: null, revenueMeasured: false, ...over });

  it('high frequency + weak CTR → REFRESH (not a fabricated KILL)', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: aware({ frequency: 4.2, ctr: 0.8 }) });
    expect(r.verdict).toBe(VERDICT.REFRESH);
    expect(r.rationale).toMatch(/no revenue measured/i);
  });

  it('a saturated awareness campaign is NEVER KILL — roas null must not read as < breakeven', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: aware({ frequency: 5.0, ctr: 0.4 }) });
    expect(r.verdict).not.toBe(VERDICT.KILL);
    expect(r.verdict).toBe(VERDICT.REFRESH);
  });

  it('frequency rising but CTR still ok → WATCH (monitor, not act)', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: aware({ frequency: 3.2, ctr: 1.5 }) });
    expect(r.verdict).toBe(VERDICT.WATCH);
  });

  it('weak CTR, no fatigue → HOLD', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: aware({ frequency: 1.2, ctr: 0.3 }) });
    expect(r.verdict).toBe(VERDICT.HOLD);
  });

  it('healthy engagement → HOLD, with an engagement-only rationale and no SCALE', () => {
    const r = evaluateVerdict({ level: 'CAMPAIGN', metrics: aware({ frequency: 1.4, ctr: 1.8 }) });
    expect(r.verdict).toBe(VERDICT.HOLD);
    expect(r.verdict).not.toBe(VERDICT.SCALE);
    expect(r.rationale).toMatch(/engagement only/i);
  });

  it('revenueMeasured defaults TRUE when absent — legacy direct callers are unchanged', () => {
    // No revenueMeasured key → measured path → the old KILL override still fires.
    const r = evaluateVerdict({ level: 'ADSET', metrics: { ctr: 0.4, cpc: 2, cpm: 10, frequency: 4.2, spend: 1000, conversions: 2, roas: 0.6 } });
    expect(r.verdict).toBe(VERDICT.KILL);
  });
});

describe('rollupVerdicts — multi-level consistency', () => {
  // A campaign with TWO ad sets:
  //  - winner: huge revenue, healthy → SCALE
  //  - loser: money-losing + saturated → KILL
  // The campaign rolls up to net-positive ROAS → SCALE while a child is KILL.
  const tree = {
    id: 'camp-1', level: 'CAMPAIGN', currency: 'USD',
    children: [
      {
        id: 'adset-winner', level: 'ADSET',
        children: [creative('cr-w', { spendMinor: 100000, revenueMinor: 600000, impressions: 100000, clicks: 3000, conversions: 120, frequency: 1.4 })],
      },
      {
        id: 'adset-loser', level: 'ADSET',
        children: [creative('cr-l', { spendMinor: 50000, revenueMinor: 20000, impressions: 60000, clicks: 240, conversions: 4, frequency: 4.2 })],
      },
    ],
  };

  it('annotates a verdict at every level', () => {
    const r = rollupVerdicts(tree);
    expect(r.verdict).toBeDefined();
    expect(r.children[0].verdict).toBeDefined();
    expect(r.children[0].children[0].verdict).toBeDefined(); // creative level
  });

  it('campaign can be SCALE while a child ad set is KILL', () => {
    const r = rollupVerdicts(tree);
    const winner = r.children.find((c) => c.id === 'adset-winner');
    const loser  = r.children.find((c) => c.id === 'adset-loser');
    expect(loser.verdict).toBe(VERDICT.KILL);
    expect(r.verdict).toBe(VERDICT.SCALE);
    expect(winner.verdict).toBe(VERDICT.SCALE);
  });

  it('parent spend/revenue equals the rollup of children (consistent with rollup)', () => {
    const r = rollupVerdicts(tree);
    expect(r.metrics.spendMinor).toBe(150000);   // 100000 + 50000
    expect(r.metrics.revenueMinor).toBe(620000); // 600000 + 20000
  });

  it('does not mutate the input tree', () => {
    const before = JSON.stringify(tree);
    rollupVerdicts(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('aggregateMetrics — frequency is impression-weighted', () => {
  it('weights child frequency by impressions', () => {
    const children = [
      { metrics: { spendMinor: 0, revenueMinor: 0, impressions: 100, clicks: 0, conversions: 0, frequency: 2 } },
      { metrics: { spendMinor: 0, revenueMinor: 0, impressions: 300, clicks: 0, conversions: 0, frequency: 6 } },
    ];
    const agg = aggregateMetrics({ level: 'ADSET' }, children);
    // (2*100 + 6*300) / 400 = 5
    expect(agg.frequency).toBe(5);
  });
});

describe('verdictToActionType', () => {
  it('maps KILL by level', () => {
    expect(verdictToActionType(VERDICT.KILL, 'CAMPAIGN')).toBe('PAUSE_CAMPAIGN');
    expect(verdictToActionType(VERDICT.KILL, 'ADSET')).toBe('PAUSE_ADSET');
  });
  it('maps the new verdicts', () => {
    expect(verdictToActionType(VERDICT.REALLOCATE, 'ADSET')).toBe('REALLOCATE_BUDGET');
    expect(verdictToActionType(VERDICT.REFRESH, 'AD')).toBe('REFRESH_CREATIVE');
  });
  it('returns null for monitor-only verdicts', () => {
    expect(verdictToActionType(VERDICT.HOLD, 'ADSET')).toBeNull();
    expect(verdictToActionType(VERDICT.WATCH, 'ADSET')).toBeNull();
  });
});
