// ============================================================
// campaignGrouping — pure decision-queue banding + ordering
// ------------------------------------------------------------
// The maps are FLAT (entityId → 'KILL', entityId → 7), matching what
// CampaignsView actually builds. Pinning that here: an object-shaped read
// (`?.verdict`) would send every campaign to UNSCORED and collapse the queue.
// ============================================================
import { describe, it, expect } from 'vitest';
import { groupCampaigns, GROUPS, GROUP_ORDER, GROUP_CONFIG } from '../campaignGrouping.js';

const c = (entityId, over = {}) => ({ entityId, name: entityId, spendMinor: 0, ...over });

describe('groupCampaigns — verdict → band', () => {
  const cases = [
    ['KILL', GROUPS.ACTION],
    ['REALLOCATE', GROUPS.ACTION],
    ['WATCH', GROUPS.WATCHING],
    ['REFRESH', GROUPS.WATCHING],
    ['HOLD', GROUPS.HEALTHY],
    ['SCALE', GROUPS.HEALTHY],
  ];

  it.each(cases)('%s → %s band', (verdict, band) => {
    const g = groupCampaigns([c('a')], { a: verdict });
    expect(g[band].map((x) => x.entityId)).toEqual(['a']);
  });

  it('covers all six engine verdicts — no campaign is lost', () => {
    const campaigns = cases.map(([v]) => c(v));
    const verdicts = Object.fromEntries(cases.map(([v]) => [v, v]));
    const g = groupCampaigns(campaigns, verdicts);
    const total = GROUP_ORDER.reduce((n, k) => n + g[k].length, 0);
    expect(total).toBe(6);
    expect(g[GROUPS.UNSCORED]).toHaveLength(0);
  });
});

describe('groupCampaigns — unscored is not healthy', () => {
  it('a null verdict → UNSCORED (not dropped, not HEALTHY)', () => {
    const g = groupCampaigns([c('a')], { a: null });
    expect(g[GROUPS.UNSCORED].map((x) => x.entityId)).toEqual(['a']);
    expect(g[GROUPS.HEALTHY]).toHaveLength(0);
  });

  it('an undefined verdict (gated out — absent from the map) → UNSCORED', () => {
    const g = groupCampaigns([c('gated')], {});
    expect(g[GROUPS.UNSCORED].map((x) => x.entityId)).toEqual(['gated']);
  });

  it('an unrecognised verdict falls to UNSCORED rather than vanishing', () => {
    const g = groupCampaigns([c('a')], { a: 'SOME_NEW_VERDICT' });
    expect(g[GROUPS.UNSCORED]).toHaveLength(1);
  });

  it('reads the FLAT map shape — an object-shaped read would break this', () => {
    // Guard against regressing to `verdicts[id]?.verdict`.
    const g = groupCampaigns([c('a')], { a: 'KILL' });
    expect(g[GROUPS.ACTION]).toHaveLength(1);
  });
});

describe('groupCampaigns — ordering within a band', () => {
  it('impactScore desc', () => {
    const g = groupCampaigns(
      [c('low'), c('high'), c('mid')],
      { low: 'KILL', high: 'KILL', mid: 'KILL' },
      { low: 2, high: 9, mid: 5 },
    );
    expect(g[GROUPS.ACTION].map((x) => x.entityId)).toEqual(['high', 'mid', 'low']);
  });

  it('a scored campaign always outranks an unscored one (missing ≠ zero)', () => {
    const g = groupCampaigns(
      [c('noScore', { spendMinor: 999999 }), c('scored', { spendMinor: 1 })],
      { noScore: 'KILL', scored: 'KILL' },
      { scored: 1 },
    );
    expect(g[GROUPS.ACTION].map((x) => x.entityId)).toEqual(['scored', 'noScore']);
  });

  it('spendMinor desc breaks the tie when neither has an impact score', () => {
    const g = groupCampaigns(
      [c('small', { spendMinor: 100 }), c('big', { spendMinor: 90000 })],
      { small: 'HOLD', big: 'HOLD' },
      {},
    );
    expect(g[GROUPS.HEALTHY].map((x) => x.entityId)).toEqual(['big', 'small']);
  });

  it('spendMinor desc also breaks an equal-impact tie', () => {
    const g = groupCampaigns(
      [c('a', { spendMinor: 10 }), c('b', { spendMinor: 500 })],
      { a: 'KILL', b: 'KILL' },
      { a: 7, b: 7 },
    );
    expect(g[GROUPS.ACTION].map((x) => x.entityId)).toEqual(['b', 'a']);
  });

  it('name asc is the final tiebreak', () => {
    const g = groupCampaigns(
      [c('zebra', { name: 'Zebra' }), c('alpha', { name: 'Alpha' })],
      { zebra: 'SCALE', alpha: 'SCALE' },
      {},
    );
    expect(g[GROUPS.HEALTHY].map((x) => x.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('a missing spend sorts as 0 without throwing', () => {
    const g = groupCampaigns(
      [c('nospend', { spendMinor: null }), c('spend', { spendMinor: 5 })],
      { nospend: 'HOLD', spend: 'HOLD' },
      {},
    );
    expect(g[GROUPS.HEALTHY].map((x) => x.entityId)).toEqual(['spend', 'nospend']);
  });
});

describe('groupCampaigns — contract', () => {
  it('does not mutate the input array', () => {
    const input = [c('b'), c('a')];
    const snapshot = [...input];
    groupCampaigns(input, { a: 'KILL', b: 'KILL' }, { a: 9, b: 1 });
    expect(input).toEqual(snapshot);
  });

  it('no campaigns → every band empty (never undefined)', () => {
    const g = groupCampaigns([], {}, {});
    for (const key of GROUP_ORDER) expect(g[key]).toEqual([]);
  });

  it('never throws on absent arguments', () => {
    expect(() => groupCampaigns()).not.toThrow();
    expect(groupCampaigns()[GROUPS.ACTION]).toEqual([]);
  });

  it('skips null entries rather than crashing', () => {
    const g = groupCampaigns([null, c('a')], { a: 'KILL' });
    expect(g[GROUPS.ACTION]).toHaveLength(1);
  });

  it('band order puts what needs acting on first, data gaps last', () => {
    expect(GROUP_ORDER).toEqual([GROUPS.ACTION, GROUPS.WATCHING, GROUPS.HEALTHY, GROUPS.UNSCORED]);
    expect(GROUP_CONFIG[GROUPS.ACTION].label).toBe('Needs Action');
    expect(GROUP_CONFIG[GROUPS.UNSCORED].label).toBe('Needs Data');
  });
});
