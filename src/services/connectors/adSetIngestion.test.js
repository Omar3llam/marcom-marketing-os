// ============================================================
// Meta ad-set ingestion — fetch → merge → normalize
// ------------------------------------------------------------
// The schema, snapshotSink and the entity-graph drill-down were all built for
// ad-sets already; nothing live ever produced a row below CAMPAIGN, so
// getCampaignAdSets returned [] on every real workspace while working perfectly
// on a seeded demo. This closes that, and most of these tests guard the ways
// the new level could quietly lie:
//
//   · ad-set spend double-counted into the account rollup (it is a SUBSET of
//     its campaign's — summing both roughly doubles every account figure)
//   · a non-delivering ad-set landing a fabricated zero instead of "unknown"
//   · parentExternalId pointing at the account, orphaning every ad-set
//   · a truncated fetch presented as a complete account
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  mergeMetaAdSets, ADSET_INSIGHT_FIELDS, CAMPAIGN_INSIGHT_FIELDS, collectCursorPages,
} from '../metaAdsService.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { toEntityOps, toSnapshotRows } from './snapshotSink.js';
import { nextHealth } from './connectorHealth.js';

const insight = (over = {}) => ({
  adset_id: 'as1', adset_name: 'Lookalike 1%', campaign_id: 'c1', campaign_name: 'Spring',
  spend: '100', impressions: '1000', clicks: '50', reach: '800', frequency: '1.25',
  actions: [{ action_type: 'purchase', value: '4' }],
  action_values: [{ action_type: 'purchase', value: '400' }],
  ...over,
});
const rosterRow = (over = {}) => ({ id: 'as2', name: 'Broad', campaign_id: 'c1', status: 'ACTIVE', ...over });

const normalize = (rows) =>
  metaNormalize({ accountExternalId: 'act_1', accountName: 'Acme', currency: 'USD', date: new Date('2026-07-28'), rows });

const atLevel = (out, level) => out.filter((r) => r.entityLevel === level);

beforeEach(() => vi.clearAllMocks());

// ════════════════════════════════════════════════════════════
describe('ADSET_INSIGHT_FIELDS', () => {
  // A shared mutable list is how "someone dropped action_values and every
  // campaign showed — for ROAS" comes back.
  it('is a SEPARATE constant, not the campaign list', () => {
    expect(ADSET_INSIGHT_FIELDS).not.toBe(CAMPAIGN_INSIGHT_FIELDS);
    expect(Object.isFrozen(ADSET_INSIGHT_FIELDS)).toBe(true);
  });

  it('carries the ad-set identity AND the parent campaign id', () => {
    expect(ADSET_INSIGHT_FIELDS).toContain('adset_id');
    expect(ADSET_INSIGHT_FIELDS).toContain('campaign_id');
  });

  // Revenue honesty: without action_values Meta omits revenue entirely and ROAS
  // reads unmeasured — the exact regression the campaign constant documents.
  it('keeps every revenue-bearing field the campaign list has', () => {
    for (const f of ['spend', 'impressions', 'reach', 'frequency', 'clicks', 'actions', 'action_values']) {
      expect(ADSET_INSIGHT_FIELDS).toContain(f);
    }
  });

  it('does not mutate the campaign list', () => {
    expect(CAMPAIGN_INSIGHT_FIELDS).not.toContain('adset_id');
  });
});

// ════════════════════════════════════════════════════════════
describe('mergeMetaAdSets', () => {
  it('an insight row keeps its real data and is not roster-only', () => {
    const [row] = mergeMetaAdSets([insight()], []);
    expect(row).toMatchObject({ adset_id: 'as1', spend: '100' });
    expect(row._rosterOnly).toBeUndefined();
  });

  it('a roster-only ad-set is flagged, so the sink lands no fabricated zero', () => {
    const out = mergeMetaAdSets([], [rosterRow()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ adset_id: 'as2', adset_name: 'Broad', campaign_id: 'c1', _rosterOnly: true });
  });

  it('insights WIN over the roster for the same id', () => {
    const out = mergeMetaAdSets([insight()], [{ id: 'as1', name: 'Stale name', campaign_id: 'c1' }]);
    expect(out).toHaveLength(1);
    expect(out[0].spend).toBe('100');
    expect(out[0]._rosterOnly).toBeUndefined();
  });

  it('unwraps the SDK _data envelope on both inputs', () => {
    const out = mergeMetaAdSets([{ _data: insight() }], [{ _data: rosterRow() }]);
    expect(out.map((r) => r.adset_id)).toEqual(['as1', 'as2']);
  });

  // A parentless ad-set would compute a garbage campaign FK in snapshotSink and
  // either orphan itself or attach to the wrong campaign.
  it('drops a roster ad-set with no campaign_id', () => {
    expect(mergeMetaAdSets([], [rosterRow({ campaign_id: undefined })])).toEqual([]);
  });

  it('drops an insight row with no adset_id', () => {
    expect(mergeMetaAdSets([insight({ adset_id: undefined })], [])).toEqual([]);
  });

  it.each([
    ['empty insights', [], [rosterRow()], 1],
    ['empty roster', [insight()], [], 1],
    ['both empty', [], [], 0],
    ['both undefined', undefined, undefined, 0],
  ])('survives %s', (_label, a, b, expected) => {
    expect(mergeMetaAdSets(a, b)).toHaveLength(expected);
  });
});

// ════════════════════════════════════════════════════════════
describe('metaNormalize — ad-set rows', () => {
  it('emits ADSET rows alongside the campaigns', () => {
    const out = normalize([{ campaign_id: 'c1', campaign_name: 'Spring', spend: '100' }, insight()]);
    expect(atLevel(out, 'ADSET')).toHaveLength(1);
    expect(atLevel(out, 'CAMPAIGN')).toHaveLength(1);
  });

  // The load-bearing wiring: snapshotSink chains ADSET → CAMPAIGN → ACCOUNT.
  // Pointing at the account computes a campaign id that does not exist.
  it('parentExternalId is the CAMPAIGN id, not the account', () => {
    const [row] = atLevel(normalize([insight()]), 'ADSET');
    expect(row.parentExternalId).toBe('c1');
    expect(row.parentExternalId).not.toBe('act_1');
  });

  it('carries the same measures the campaign level does', () => {
    const [row] = atLevel(normalize([insight()]), 'ADSET');
    expect(row).toMatchObject({
      externalId: 'as1',
      name: 'Lookalike 1%',
      spendMinor: 10_000,     // $100 → minor units
      revenueMinor: 40_000,   // action_values purchase
      impressions: 1000,
      clicks: 50,
      conversions: 4,
      reach: 800,
    });
  });

  // Currency threads from auth → normalize. A hardcoded 'USD' here would undo
  // the whole currency-detection layer for every non-USD account.
  it('uses the passed currency, not a hardcoded USD', () => {
    const out = metaNormalize({
      accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-07-28'), rows: [insight()],
    });
    expect(atLevel(out, 'ADSET')[0].currency).toBe('EGP');
  });

  it('forwards the roster-only flag', () => {
    const out = normalize(mergeMetaAdSets([], [rosterRow()]));
    expect(atLevel(out, 'ADSET')[0].rosterOnly).toBe(true);
  });

  it('drops an ad-set row with no resolvable parent', () => {
    const out = normalize([insight({ campaign_id: undefined })]);
    expect(atLevel(out, 'ADSET')).toEqual([]);
  });

  it('a campaign row is still recognised as CAMPAIGN, not an ad-set', () => {
    const out = normalize([{ campaign_id: 'c1', campaign_name: 'Spring', spend: '10' }]);
    expect(atLevel(out, 'ADSET')).toEqual([]);
    expect(atLevel(out, 'CAMPAIGN')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════
describe('the account rollup does NOT double-count ad-sets', () => {
  // Ad-set spend is a SUBSET of its campaign's. Summing both levels would
  // roughly double every account-level figure — a fabricated number.
  it('sums campaigns only', () => {
    const out = normalize([
      { campaign_id: 'c1', campaign_name: 'Spring', spend: '100', impressions: '1000', clicks: '50' },
      insight({ spend: '60' }),
      insight({ adset_id: 'as2', spend: '40' }),
    ]);

    const [account] = atLevel(out, 'ACCOUNT');
    expect(account.spendMinor).toBe(10_000); // the campaign's $100, NOT $200
  });

  it('an account with only ad-set rows and no campaigns lands no phantom rollup', () => {
    const out = normalize([insight()]);
    expect(atLevel(out, 'ACCOUNT')).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
describe('the sink receives what it needs', () => {
  const normalized = () => normalize([
    { campaign_id: 'c1', campaign_name: 'Spring', spend: '100' },
    insight(),
    ...mergeMetaAdSets([], [rosterRow()]),
  ]);

  it('lands an adSet entity with a campaign FK', () => {
    const ops = toEntityOps('ws-1', 'META', normalized());
    const adSetOps = ops.filter((o) => o.level === 'ADSET');

    expect(adSetOps).toHaveLength(2);
    expect(adSetOps[0].model).toBe('adSet');
    expect(adSetOps[0].data.campaignId).toBeTruthy();
  });

  it('orders parents before children so the FK resolves', () => {
    const levels = toEntityOps('ws-1', 'META', normalized()).map((o) => o.level);
    expect(levels.indexOf('ACCOUNT')).toBeLessThan(levels.indexOf('CAMPAIGN'));
    expect(levels.indexOf('CAMPAIGN')).toBeLessThan(levels.indexOf('ADSET'));
  });

  // The PR #160 correction, one level down: entity yes, snapshot no.
  it('a roster-only ad-set lands an entity but NO snapshot', () => {
    const rows = toSnapshotRows('ws-1', 'META', normalized());
    const snapshotIds = rows.filter((r) => r.entityLevel === 'ADSET');

    expect(snapshotIds).toHaveLength(1); // only the delivering ad-set
    expect(toEntityOps('ws-1', 'META', normalized()).filter((o) => o.level === 'ADSET')).toHaveLength(2);
  });

  it('the ad-set snapshot carries its own entityLevel', () => {
    const rows = toSnapshotRows('ws-1', 'META', normalized());
    expect(rows.find((r) => r.entityLevel === 'ADSET')).toMatchObject({ entityLevel: 'ADSET', spendMinor: 10_000 });
  });
});

// ════════════════════════════════════════════════════════════
describe('truncation is reported, not swallowed', () => {
  const fakeCursor = (pages) => {
    let page = 0;
    return {
      [Symbol.iterator]: function* () { yield { _data: { adset_id: `as${page}` } }; },
      hasNext: () => page < pages - 1,
      next: async () => { page += 1; },
    };
  };

  it('a complete fetch reports truncated: false', async () => {
    const { rows, truncated } = await collectCursorPages(fakeCursor(2));
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('hitting the page ceiling reports truncated: true', async () => {
    const { truncated } = await collectCursorPages(fakeCursor(999));
    expect(truncated).toBe(true);
  });
});

describe('nextHealth — the warning state', () => {
  // A partial sync is neither a clean success nor a failure. Reporting it as
  // plain success is the "looks complete, isn't" failure.
  it('a successful-but-partial sync records a warning and no error', () => {
    const h = nextHealth({}, { platform: 'meta', ok: true, warning: 'partial', records: 10 });
    expect(h).toMatchObject({ lastError: null, lastWarning: 'partial', recordsImported: 10 });
    expect(h.lastSuccessfulSync).toBeTruthy();
  });

  it('a clean sync clears a stale warning', () => {
    const h = nextHealth({ lastWarning: 'partial' }, { platform: 'meta', ok: true, records: 10 });
    expect(h.lastWarning).toBeNull();
  });

  // A failed attempt learned nothing about completeness — it must not invent or
  // erase the last known warning.
  it('a failure preserves the prior warning rather than clearing it', () => {
    const h = nextHealth({ lastWarning: 'partial' }, { platform: 'meta', ok: false, error: 'boom' });
    expect(h.lastWarning).toBe('partial');
    expect(h.lastError).toBe('boom');
  });
});
