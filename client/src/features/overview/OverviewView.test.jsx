// ============================================================
// overviewKpis + decisionFeed — Home's two pure derivations
// ------------------------------------------------------------
// The Home KPI strip must read the SAME connector substrate as the Campaigns
// page (not the disjoint legacy CampaignState feed) and must never fabricate a 0
// for an absent metric. decisionFeed joins the three sources behind the decision
// cards — health (verdict + the only impactScore), the connector row (the
// metrics the drill-down needs) and the verdict row (the engine's rationale) —
// and must leave a field null when no source carries it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { overviewKpis, decisionFeed } from './OverviewView.jsx';

describe('decisionFeed', () => {
  const health = (over = {}) => ({ entityId: 'c1', name: 'Ramadan Cold', verdict: 'KILL', impactScore: 9, ...over });
  const connector = (over = {}) => ({ entityId: 'c1', name: 'Ramadan Cold', ctr: 0.0164, spendMinor: 655_300, currency: 'EGP', ...over });

  it('joins the three sources on entityId', () => {
    const [d] = decisionFeed({
      healthCampaigns: [health()],
      connectorCampaigns: [connector()],
      verdicts: [{ id: 'c1', rationale: 'Lowest CTR in its group' }],
    });
    expect(d).toMatchObject({
      entityId: 'c1', name: 'Ramadan Cold', verdict: 'KILL', impactScore: 9,
      rationale: 'Lowest CTR in its group', ctr: 0.0164, spendMinor: 655_300, currency: 'EGP',
    });
  });

  // Same population rule the old AlertsPanel used — the presentation changed,
  // not which campaigns the page surfaces.
  it('keeps KILL and high-impact WATCH, drops the rest', () => {
    const feed = decisionFeed({ healthCampaigns: [
      health({ entityId: 'k', verdict: 'KILL', impactScore: 2 }),
      health({ entityId: 'w-hi', verdict: 'WATCH', impactScore: 8 }),
      health({ entityId: 'w-lo', verdict: 'WATCH', impactScore: 4 }),
      health({ entityId: 'h', verdict: 'HOLD', impactScore: 9 }),
    ] });
    expect(feed.map((d) => d.entityId)).toEqual(['w-hi', 'k']);
  });

  it('orders by impact, most urgent first', () => {
    const feed = decisionFeed({ healthCampaigns: [
      health({ entityId: 'a', impactScore: 5 }),
      health({ entityId: 'b', impactScore: 9 }),
      health({ entityId: 'c', impactScore: 7 }),
    ] });
    expect(feed.map((d) => d.entityId)).toEqual(['b', 'c', 'a']);
  });

  // A campaign with no connector row still deserves its verdict shown; the
  // metrics simply stay null and the drill-down renders nothing.
  it('a health row with no connector match keeps null metrics, never zeros', () => {
    const [d] = decisionFeed({ healthCampaigns: [health()], connectorCampaigns: [] });
    expect(d).toMatchObject({ ctr: null, spendMinor: null, currency: null, rationale: null });
  });

  it('carries the engine next-step for KILL and nothing for WATCH', () => {
    const feed = decisionFeed({ healthCampaigns: [
      health({ entityId: 'k', verdict: 'KILL', impactScore: 9 }),
      health({ entityId: 'w', verdict: 'WATCH', impactScore: 8 }),
    ] });
    expect(feed.find((d) => d.entityId === 'k').humanAction).toBe('Pause and reallocate budget');
    expect(feed.find((d) => d.entityId === 'w').humanAction).toBeNull();
  });

  it('no health data is an empty feed, not a throw', () => {
    expect(decisionFeed({})).toEqual([]);
  });
});

describe('overviewKpis', () => {
  it('uses the live connector aggregate when a channel has synced (legacy ignored)', () => {
    const k = overviewKpis({
      connectorCampaigns: [
        { spendMinor: 300000, conversions: 30, currency: 'EGP' },
        { spendMinor: 100000, conversions: 10, currency: 'EGP' },
      ],
      summary: { spend: 999, blendedCpa: 999, wasted: 999, health: 12 }, // must NOT leak through when live
      health: { score: 82, wastedSpend: { minor: 50000 } },
      currency: 'USD',
    });
    expect(k.live).toBe(true);
    expect(k.currency).toBe('EGP');       // real per-connector currency wins
    expect(k.spend).toBe(4000);           // 400000 minor / 100
    expect(k.cpa).toBeCloseTo(100);       // 400000 / 40 conv / 100
    expect(k.wasted).toBe(500);           // fromMinor(50000, EGP)
    expect(k.health).toBe(82);            // deterministic engine, not legacy 12
  });

  it('returns null for every KPI when there is no data at all (→ "—", never 0)', () => {
    const k = overviewKpis({ connectorCampaigns: [], summary: null, health: null, currency: 'USD' });
    expect(k.live).toBe(false);
    expect(k.spend).toBeNull();
    expect(k.cpa).toBeNull();
    expect(k.wasted).toBeNull();
    expect(k.health).toBeNull();
  });

  it('falls back to the legacy summary only when no channel has synced', () => {
    const k = overviewKpis({
      connectorCampaigns: [],
      summary: { spend: 1200, blendedCpa: 45, wasted: 300, health: 60 },
      health: null,
      currency: 'USD',
    });
    expect(k.live).toBe(false);
    expect(k.spend).toBe(1200);
    expect(k.cpa).toBe(45);
    expect(k.wasted).toBe(300);
    expect(k.health).toBe(60);
  });

  it('connector present but metrics absent → null, never a fabricated 0', () => {
    const k = overviewKpis({
      connectorCampaigns: [{ spendMinor: null, conversions: null, currency: 'USD' }],
      summary: { spend: 500 }, // ignored because live
      health: null,
      currency: 'USD',
    });
    expect(k.live).toBe(true);
    expect(k.spend).toBeNull();
    expect(k.cpa).toBeNull();
    expect(k.health).toBeNull();
  });
});
