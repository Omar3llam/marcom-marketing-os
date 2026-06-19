import { describe, it, expect } from 'vitest';
import { buildConnectorVerdictTree, hasMeasuredRevenue } from './connectorVerdictService.js';
import { rollupVerdicts } from './verdictEngine.js';

const WS = '7517d1b9-b967-44f3-a77f-60f5c577f867';

// A connector row as EntityGraphService projects it (flat, minor units).
const row = (over = {}) => ({
  entityId: 'c1', name: 'Eid Sale', channel: 'META',
  spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
  conversions: 8, frequency: 1.5, currency: 'USD', roas: 4, ctr: 0.05,
  ...over,
});

describe('hasMeasuredRevenue — the governing-law gate', () => {
  it('true only with positive measured revenue AND real spend', () => {
    expect(hasMeasuredRevenue(row())).toBe(true);
  });

  // The load-bearing cases: revenue lands 0 (snapshotSink `|| 0`), never null,
  // when it was never measured. Each of these must NOT be verdict-eligible —
  // scoring them would fabricate a KILL from data that doesn't exist.
  it('false when revenue is a measured/unmeasured 0', () => {
    expect(hasMeasuredRevenue(row({ revenueMinor: 0 }))).toBe(false);
  });
  it('false when revenue is null (no snapshot)', () => {
    expect(hasMeasuredRevenue(row({ revenueMinor: null }))).toBe(false);
  });
  it('false when spend is 0 (no real denominator for roas)', () => {
    expect(hasMeasuredRevenue(row({ spendMinor: 0 }))).toBe(false);
  });
  it('false when revenue is negative or non-finite', () => {
    expect(hasMeasuredRevenue(row({ revenueMinor: -100 }))).toBe(false);
    expect(hasMeasuredRevenue(row({ revenueMinor: undefined }))).toBe(false);
  });
});

describe('buildConnectorVerdictTree', () => {
  it('puts only revenue-eligible campaigns in the tree, the rest in gatedOut', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [
      row({ entityId: 'a', name: 'Has revenue' }),
      row({ entityId: 'b', name: 'No revenue', revenueMinor: 0 }),
      row({ entityId: 'd', name: 'No snapshot', revenueMinor: null }),
    ]);
    expect(tree.children.map((c) => c.id)).toEqual(['a']);
    expect(gatedOut.map((g) => g.id).sort()).toEqual(['b', 'd']);
    expect(gatedOut[0].reason).toBe('no measured revenue');
  });

  it('feeds the engine RAW metrics (revenue/impressions/clicks), never zero-filled', () => {
    const { tree } = buildConnectorVerdictTree(WS, [row()]);
    expect(tree.children[0].metrics).toMatchObject({
      spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
    });
  });

  it('returns a null tree when no campaign is eligible (caller must not fabricate)', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [row({ revenueMinor: 0 })]);
    expect(tree).toBeNull();
    expect(gatedOut).toHaveLength(1);
  });

  it('empty input → null tree, empty gatedOut', () => {
    expect(buildConnectorVerdictTree(WS, [])).toEqual({ tree: null, gatedOut: [] });
  });
});

// The contrast that proves the wiring is honest: measured revenue yields a REAL
// engine verdict (KILL when truly losing, SCALE when strong); unmeasured revenue
// yields NO verdict at all — it never reaches the engine.
describe('connector tree → rollupVerdicts (end to end)', () => {
  it('strong, healthy, profitable campaign → SCALE', () => {
    const { tree } = buildConnectorVerdictTree(WS, [row()]);
    const annotated = rollupVerdicts(tree);
    expect(annotated.children[0].verdict).toBe('SCALE');
  });

  it('measured, losing money, saturated → KILL (a legitimate kill from real data)', () => {
    const { tree } = buildConnectorVerdictTree(WS, [
      row({ revenueMinor: 2000, frequency: 4.0 }), // roas 0.2, freq past the 3.5 ceiling
    ]);
    const annotated = rollupVerdicts(tree);
    expect(annotated.children[0].verdict).toBe('KILL');
  });

  it('a zero-revenue campaign never produces a verdict (no fabricated KILL)', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [row({ revenueMinor: 0 })]);
    expect(tree).toBeNull();            // nothing reaches the engine
    expect(gatedOut[0].name).toBe('Eid Sale');
  });
});
