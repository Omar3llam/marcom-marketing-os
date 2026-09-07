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
import { overviewKpis, decisionFeed, partitionDecisions, SECTION_CAP } from './overviewDerive.js';

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

  // The join is now exhaustive: the calm bands can only show HOLD/SCALE rows, so
  // a feed that filtered them out would leave "Doing well" permanently empty.
  // partitionDecisions owns which band a verdict lands in.
  it('carries every scored verdict through — the bands do the filtering', () => {
    const feed = decisionFeed({ healthCampaigns: [
      health({ entityId: 'k', verdict: 'KILL', impactScore: 2 }),
      health({ entityId: 'w', verdict: 'WATCH', impactScore: 4 }),
      health({ entityId: 'h', verdict: 'HOLD', impactScore: 9 }),
      health({ entityId: 's', verdict: 'SCALE', impactScore: 3 }),
    ] });
    expect(feed.map((d) => d.entityId).sort()).toEqual(['h', 'k', 's', 'w']);
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

describe('partitionDecisions', () => {
  const d = (over = {}) => ({ entityId: 'c1', verdict: 'KILL', impactScore: 5, spendMinor: 1000, currency: 'USD', ...over });

  it('sorts each band by impact, most urgent first', () => {
    const { actNow } = partitionDecisions([
      d({ entityId: 'a', impactScore: 5 }),
      d({ entityId: 'b', impactScore: 9 }),
      d({ entityId: 'c', impactScore: 7 }),
    ]);
    expect(actNow.map((x) => x.entityId)).toEqual(['b', 'c', 'a']);
  });

  // Without this, equal-impact rows keep whatever order the health route
  // happened to return — so "highest impact first" would re-order between
  // renders on the same data.
  it('breaks an impact tie by spend, descending and deterministically', () => {
    const rows = [
      d({ entityId: 'small', impactScore: 8, spendMinor: 10_000 }),
      d({ entityId: 'big',   impactScore: 8, spendMinor: 90_000 }),
      d({ entityId: 'mid',   impactScore: 8, spendMinor: 50_000 }),
    ];
    const order = () => partitionDecisions(rows).actNow.map((x) => x.entityId);
    expect(order()).toEqual(['big', 'mid', 'small']);
    expect(order()).toEqual(['big', 'mid', 'small']); // stable across calls
  });

  it('a row missing both impact and spend sorts last, never throws', () => {
    const { actNow } = partitionDecisions([
      d({ entityId: 'blank', impactScore: null, spendMinor: null }),
      d({ entityId: 'real', impactScore: 6 }),
    ]);
    expect(actNow.map((x) => x.entityId)).toEqual(['real', 'blank']);
  });

  it('caps a band at SECTION_CAP but reports the TRUE total', () => {
    const rows = Array.from({ length: 14 }, (_, i) => d({ entityId: `c${i}`, impactScore: 10 - i }));
    const { actNow, actNowTotal } = partitionDecisions(rows);
    expect(actNow).toHaveLength(SECTION_CAP);
    expect(SECTION_CAP).toBe(3);
    expect(actNowTotal).toBe(14); // the "view all N" number, not the card count
  });

  it('routes each verdict to its band, exhaustively over the enum', () => {
    const { actNow, watchNow, healthyCount } = partitionDecisions([
      d({ entityId: 'kill', verdict: 'KILL' }),
      d({ entityId: 'realloc', verdict: 'REALLOCATE' }),
      d({ entityId: 'watch', verdict: 'WATCH' }),
      d({ entityId: 'refresh', verdict: 'REFRESH' }),
      d({ entityId: 'hold', verdict: 'HOLD' }),
      d({ entityId: 'scale', verdict: 'SCALE' }),
    ]);
    expect(actNow.map((x) => x.entityId).sort()).toEqual(['kill', 'realloc']);
    expect(watchNow.map((x) => x.entityId).sort()).toEqual(['refresh', 'watch']);
    expect(healthyCount).toBe(2);
  });

  // "Unscored" is not "healthy" — a campaign the engine returned no verdict for
  // must not be counted as performing well.
  it('a campaign with no verdict lands in no band at all', () => {
    const b = partitionDecisions([d({ verdict: null }), d({ entityId: 'x', verdict: undefined })]);
    expect(b).toMatchObject({ actNowTotal: 0, watchTotal: 0, healthyCount: 0, healthySpend: null });
  });

  it('sums protected spend across the healthy band, skipping unreported rows', () => {
    const { healthySpend, healthyCurrency } = partitionDecisions([
      d({ entityId: 'a', verdict: 'HOLD', spendMinor: 120_000, currency: 'EGP' }),
      d({ entityId: 'b', verdict: 'SCALE', spendMinor: 80_000, currency: 'EGP' }),
      d({ entityId: 'c', verdict: 'HOLD', spendMinor: null, currency: 'EGP' }),
      d({ entityId: 'k', verdict: 'KILL', spendMinor: 999_999 }), // other band — excluded
    ]);
    expect(healthySpend).toBe(200_000);
    expect(healthyCurrency).toBe('EGP');
  });

  // Nothing measured is not zero protected.
  it('protected spend is null when no healthy campaign reported one', () => {
    const { healthyCount, healthySpend } = partitionDecisions([
      d({ verdict: 'HOLD', spendMinor: null }),
      d({ entityId: 'b', verdict: 'SCALE', spendMinor: null }),
    ]);
    expect(healthyCount).toBe(2);
    expect(healthySpend).toBeNull();
  });

  it('an empty feed is three empty bands, not a throw', () => {
    expect(partitionDecisions()).toMatchObject({
      actNow: [], actNowTotal: 0, watchNow: [], watchTotal: 0, healthyCount: 0, healthySpend: null,
    });
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

  // REPLACES "falls back to the legacy summary only when no channel has
  // synced". That fallback read the CampaignState feed's roll-up, and S1-B
  // deleted the array it summarised — so the branch could only ever be reached
  // with `summarize([])`, whose values are 0/0/0/null. FE-03 removed the
  // parameter; this pins that a caller who still passes one gets nothing from it.
  //
  // ⚠️ THREE OF THE FOUR FALLBACKS DEGRADED HONESTLY AND ONE DID NOT, and the
  // difference was the GUARD, not the data: spend and wasted were `> 0 ? : null`,
  // cpa was genuinely null, but health was `?? null` over a sentinel 0 — and
  // `0 ?? null` is 0. That 0 became `{ tone: 'danger', label: 'Needs attention' }`
  // and would have rendered as "0/100". It never reached a pixel, because
  // KpiStrip is gated on `hasAnyData`, which equalled `live` exactly. A hazard
  // held shut by a coincidence in another file is not a hazard that is closed.
  it('ignores a legacy summary entirely — including its sentinel health: 0', () => {
    const k = overviewKpis({
      connectorCampaigns: [],
      summary: { spend: 1200, blendedCpa: 45, wasted: 300, health: 0 },
      health: null,
      currency: 'USD',
    });
    expect(k.live).toBe(false);
    expect(k.spend).toBeNull();
    expect(k.cpa).toBeNull();
    expect(k.wasted).toBeNull();
    expect(k.health).toBeNull();   // not 0 — "—", not "Needs attention"
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
