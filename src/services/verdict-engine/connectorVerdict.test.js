import { describe, it, expect } from 'vitest';
import { buildConnectorVerdictTree, hasMeasuredRevenue, hasEngagement } from './connectorVerdictService.js';
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

describe('hasEngagement — awareness eligibility (delivered but no revenue)', () => {
  it('true with real spend + impressions, regardless of revenue', () => {
    expect(hasEngagement(row({ revenueMinor: 0 }))).toBe(true);
  });
  it('false when spend is 0 (a PR #156 zero-spend roster row)', () => {
    expect(hasEngagement(row({ spendMinor: 0, impressions: 0 }))).toBe(false);
  });
  it('false when impressions is 0 (no delivery)', () => {
    expect(hasEngagement(row({ impressions: 0 }))).toBe(false);
  });
  it('false on null / undefined fields', () => {
    expect(hasEngagement(row({ spendMinor: null }))).toBe(false);
    expect(hasEngagement(row({ impressions: undefined }))).toBe(false);
  });
});

describe('buildConnectorVerdictTree', () => {
  it('eligible = measured-revenue OR engaged-no-revenue; gatedOut = dataless only', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [
      row({ entityId: 'a', name: 'Has revenue' }),                                          // measured revenue
      row({ entityId: 'b', name: 'Awareness', revenueMinor: 0 }),                           // no revenue, has engagement
      row({ entityId: 'd', name: 'Dataless', revenueMinor: null, spendMinor: 0, impressions: 0 }), // no signal at all
    ]);
    expect(tree.children.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(gatedOut.map((g) => g.id)).toEqual(['d']);
    expect(gatedOut[0].reason).toBe('no measured revenue or engagement');
  });

  it('feeds the engine RAW metrics (revenue/impressions/clicks), never zero-filled', () => {
    const { tree } = buildConnectorVerdictTree(WS, [row()]);
    expect(tree.children[0].metrics).toMatchObject({
      spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
    });
  });

  it('returns a null tree when NO campaign is eligible — dataless only (caller must not fabricate)', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [row({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    expect(tree).toBeNull();
    expect(gatedOut).toHaveLength(1);
  });

  it('empty input → null tree, empty gatedOut', () => {
    expect(buildConnectorVerdictTree(WS, [])).toEqual({ tree: null, gatedOut: [] });
  });
});

// The contrast that proves the wiring is honest: measured revenue yields a REAL
// revenue verdict (KILL when truly losing, SCALE when strong); engaged-but-
// unmeasured yields an AWARENESS verdict (roas null, never KILL/SCALE); dataless
// yields NO verdict at all.
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

  it('an engaged zero-revenue campaign → an AWARENESS verdict (roas null, never a fabricated KILL)', () => {
    // spend + impressions but no revenue; saturated + weak CTR → REFRESH, not KILL.
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [
      row({ revenueMinor: 0, frequency: 5.0, clicks: 4, impressions: 1000 }), // ctr 0.4%
    ]);
    expect(gatedOut).toHaveLength(0);
    const annotated = rollupVerdicts(tree);
    expect(annotated.children[0].verdict).toBe('REFRESH');
    expect(annotated.children[0].verdict).not.toBe('KILL');
    expect(annotated.children[0].signalInput.roas).toBeNull(); // never a fabricated 0
  });

  it('a dataless campaign (zero spend + zero impressions) still produces no verdict', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [row({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    expect(tree).toBeNull();            // nothing reaches the engine
    expect(gatedOut[0].name).toBe('Eid Sale');
  });
});
