// ============================================================
// overviewKpis — connector-first KPI derivation (pure)
// ------------------------------------------------------------
// The Home KPI strip must read the SAME connector substrate as the Campaigns
// page (not the disjoint legacy CampaignState feed) and must never fabricate a 0
// for an absent metric. These assert both.
// ============================================================
import { describe, it, expect } from 'vitest';
import { overviewKpis } from './OverviewView.jsx';

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
