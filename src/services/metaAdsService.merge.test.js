// ============================================================
// metaAdsService — full-roster sync: pagination + merge + zero-spend honesty
// ============================================================
// The /insights edge only returns campaigns that DELIVERED in the window. To
// land ALL campaigns (active, paused, archived, zero-spend) the connector pairs
// it with the /campaigns roster and merges. These pin the three load-bearing
// pieces: real pagination (the SDK Cursor has no fetchAll()), the pure merge,
// and that zero-spend rows normalize to honest zeros (never skipped/fabricated).
import { describe, it, expect } from 'vitest';
import { mergeMetaCampaigns, collectCursorPages, CAMPAIGN_LIST_FIELDS } from './metaAdsService.js';
import { metaNormalize } from './connectors/normalize/metaNormalize.js';
import { toSnapshotRows, toEntityOps } from './connectors/snapshotSink.js';
import { assertNormalized } from './connectors/ChannelConnector.js';

const DATE = new Date('2026-06-01T00:00:00.000Z');

// A fake of the SDK Cursor: extends Array, mutated in place by next() — no
// fetchAll(). `pages` is an array of pages, each an array of raw _data objects.
function fakeCursor(pages) {
  let idx = 0;
  const cur = [];
  const load = (i) => { cur.length = 0; cur.push(...pages[i].map((d) => ({ _data: d }))); };
  load(0);
  cur.hasNext = () => idx < pages.length - 1;
  cur.next = async () => { idx += 1; load(idx); return cur; };
  return cur;
}

describe('collectCursorPages — walks every page (the SDK Cursor has no fetchAll)', () => {
  it('follows paging.next across multiple pages and unwraps _data', async () => {
    const { rows, pages } = await collectCursorPages(
      fakeCursor([[{ campaign_id: 'a' }], [{ campaign_id: 'b' }], [{ campaign_id: 'c' }]]),
    );
    expect(pages).toBe(3);
    expect(rows).toEqual([{ campaign_id: 'a' }, { campaign_id: 'b' }, { campaign_id: 'c' }]);
  });

  it('a single page returns in one pass', async () => {
    const { rows, pages } = await collectCursorPages(fakeCursor([[{ id: 'x' }, { id: 'y' }]]));
    expect(pages).toBe(1);
    expect(rows).toEqual([{ id: 'x' }, { id: 'y' }]);
  });

  it('tolerates a plain array (no hasNext) — returns it as page 1', async () => {
    const { rows, pages } = await collectCursorPages([{ _data: { id: 1 } }, { id: 2 }]);
    expect(pages).toBe(1);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('mergeMetaCampaigns — every campaign survives, zero-spend included', () => {
  it('keeps delivered insight rows untouched; appends only the missing as zero-spend', () => {
    const insights = [
      { campaign_id: 'c1', campaign_name: 'Delivered', spend: '100.00', impressions: '1000', clicks: '50' },
    ];
    const campaigns = [
      { id: 'c1', name: 'Delivered' }, // already in insights → not duplicated
      { id: 'c2', name: 'Dormant' },   // not in insights → appended at 0
      { id: 'c3', name: 'Archived' },  // not in insights → appended at 0
    ];
    const merged = mergeMetaCampaigns(insights, campaigns);

    expect(merged).toHaveLength(3);
    expect(merged.filter((r) => r.campaign_id === 'c1')).toHaveLength(1); // no dup
    expect(merged.find((r) => r.campaign_id === 'c1').spend).toBe('100.00'); // data kept
    expect(merged.find((r) => r.campaign_id === 'c2')).toMatchObject({ campaign_name: 'Dormant', spend: '0' });
    expect(merged.find((r) => r.campaign_id === 'c3')).toMatchObject({ campaign_name: 'Archived', spend: '0' });
  });

  it('unwraps the SDK _data envelope on both inputs', () => {
    const merged = mergeMetaCampaigns(
      [{ _data: { campaign_id: 'c1', campaign_name: 'D', spend: '10' } }],
      [{ _data: { id: 'c2', name: 'Z' } }],
    );
    expect(merged.map((r) => r.campaign_id).sort()).toEqual(['c1', 'c2']);
  });

  it('empty roster → insights pass through; empty insights → all campaigns become roster-only', () => {
    expect(mergeMetaCampaigns([{ campaign_id: 'c1', spend: '5' }], [])).toEqual([{ campaign_id: 'c1', spend: '5' }]);
    expect(mergeMetaCampaigns([], [{ id: 'c9', name: 'Solo' }])).toEqual([
      { campaign_id: 'c9', campaign_name: 'Solo', spend: '0', impressions: '0', clicks: '0', _rosterOnly: true },
    ]);
  });

  it('flags roster-only rows (no delivery data) but leaves real insight rows unflagged', () => {
    const merged = mergeMetaCampaigns(
      [{ campaign_id: 'c1', spend: '5' }],
      [{ id: 'c1', name: 'Delivered' }, { id: 'c2', name: 'Dormant' }],
    );
    expect(merged.find((r) => r.campaign_id === 'c1')._rosterOnly).toBeUndefined(); // real → no flag
    expect(merged.find((r) => r.campaign_id === 'c2')._rosterOnly).toBe(true);       // roster-only → flagged
  });

  it('skips roster rows without an id (cannot key them safely)', () => {
    const merged = mergeMetaCampaigns([], [{ name: 'No id' }, { id: 'c1', name: 'Ok' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].campaign_id).toBe('c1');
  });

  it('CAMPAIGN_LIST_FIELDS requests the keys metaNormalize maps + the real status + objective', () => {
    expect(CAMPAIGN_LIST_FIELDS).toContain('id');
    expect(CAMPAIGN_LIST_FIELDS).toContain('name');
    expect(CAMPAIGN_LIST_FIELDS).toContain('effective_status');
    expect(CAMPAIGN_LIST_FIELDS).toContain('objective'); // the field that stops leads campaigns reading as awareness
  });
});

describe('mergeMetaCampaigns — objective folds from the roster onto every row', () => {
  it('stamps the roster objective onto a DELIVERED insight row (insights carry no objective)', () => {
    const merged = mergeMetaCampaigns(
      [{ campaign_id: 'c1', campaign_name: 'Leads', spend: '100' }],       // /insights: no objective
      [{ id: 'c1', name: 'Leads', objective: 'OUTCOME_LEADS' }],           // /campaigns: has objective
    );
    expect(merged.find((r) => r.campaign_id === 'c1').objective).toBe('OUTCOME_LEADS');
  });

  it('stamps objective onto a roster-only (no-delivery) row', () => {
    const merged = mergeMetaCampaigns([], [{ id: 'c2', name: 'Reach', objective: 'OUTCOME_AWARENESS' }]);
    expect(merged[0]).toMatchObject({ campaign_id: 'c2', objective: 'OUTCOME_AWARENESS', _rosterOnly: true });
  });

  it('adds NO objective key when Meta reports none (rows stay byte-identical)', () => {
    // exact-equality guard: a missing objective must not sneak an `objective: null` in
    expect(mergeMetaCampaigns([{ campaign_id: 'c1', spend: '5' }], [{ id: 'c1' }]))
      .toEqual([{ campaign_id: 'c1', spend: '5' }]);
  });

  it('carries objective all the way to the Campaign entity op (via normalize → toEntityOps)', () => {
    const merged = mergeMetaCampaigns(
      [{ campaign_id: 'c1', campaign_name: 'Leads', spend: '100', impressions: '1000', clicks: '50', actions: [], action_values: [] }],
      [{ id: 'c1', name: 'Leads', objective: 'OUTCOME_LEADS' }],
    );
    const normalized = metaNormalize({ accountExternalId: 'act_1', currency: 'USD', date: DATE, rows: merged });
    const campaignOp = toEntityOps('ws1', 'META', normalized).find((op) => op.level === 'CAMPAIGN');
    expect(campaignOp.data.objective).toBe('OUTCOME_LEADS');
    // objective is a campaign-only column — never stamped on the account op
    const accountOp = toEntityOps('ws1', 'META', normalized).find((op) => op.level === 'ACCOUNT');
    expect(accountOp.data.objective).toBeUndefined();
  });
});

describe('roster-only campaigns: entity lands, no fabricated zero snapshot', () => {
  it('a roster-only (no-delivery) campaign lands the ENTITY but NOT a zero MetricSnapshot', () => {
    const merged = mergeMetaCampaigns(
      [{
        campaign_id: 'c1', campaign_name: 'Spent', spend: '100', impressions: '1000', clicks: '50',
        actions: [{ action_type: 'purchase', value: '4' }],
        action_values: [{ action_type: 'purchase', value: '400' }],
      }],
      [{ id: 'c1', name: 'Spent' }, { id: 'c2', name: 'Zero' }],
    );
    const normalized = metaNormalize({ accountExternalId: 'act_1', currency: 'USD', date: DATE, rows: merged });
    assertNormalized(normalized);

    // metaNormalize still surfaces BOTH campaigns; the roster one is flagged.
    const campaigns = normalized.filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaigns).toHaveLength(2);
    expect(campaigns.find((r) => r.externalId === 'c2').rosterOnly).toBe(true);
    expect(campaigns.find((r) => r.externalId === 'c1').rosterOnly).toBe(false);

    // But only the DELIVERED campaign lands a snapshot — the roster-only one shows
    // "—" (unknown), never a fabricated 0 that could overwrite real data.
    const snaps = toSnapshotRows('ws1', 'META', normalized).filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].roas).toBe(4); // c1: revenue 400 / spend 100

    // The roster-only campaign IS still an entity, so it appears in the list.
    expect(toEntityOps('ws1', 'META', normalized).filter((op) => op.level === 'CAMPAIGN')).toHaveLength(2);
  });

  it('the account rollup is roster-only only when NO real campaign delivered', () => {
    // mix (one real + one roster) → rollup reflects real spend, lands normally
    const mixed = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: DATE,
      rows: mergeMetaCampaigns(
        [{ campaign_id: 'c1', campaign_name: 'R', spend: '100', impressions: '10', clicks: '1', actions: [], action_values: [] }],
        [{ id: 'c1' }, { id: 'c2', name: 'Z' }],
      ),
    });
    expect(mixed.find((r) => r.entityLevel === 'ACCOUNT').rosterOnly).toBe(false);
    expect(toSnapshotRows('ws1', 'META', mixed).some((r) => r.entityLevel === 'ACCOUNT')).toBe(true);

    // all-roster → rollup is roster-only too, so the phantom zero account is skipped
    const allRoster = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: DATE,
      rows: mergeMetaCampaigns([], [{ id: 'c2', name: 'Z' }]),
    });
    expect(allRoster.find((r) => r.entityLevel === 'ACCOUNT').rosterOnly).toBe(true);
    expect(toSnapshotRows('ws1', 'META', allRoster)).toHaveLength(0); // nothing lands — entity-only
  });

  it('zero-spend rows leave the account rollup unchanged (they add 0)', () => {
    const spent = [{ campaign_id: 'c1', campaign_name: 'S', spend: '100', impressions: '1000', clicks: '50', actions: [], action_values: [] }];
    const acctNoZero = metaNormalize({ accountExternalId: 'act_1', currency: 'USD', date: DATE, rows: spent })
      .find((r) => r.entityLevel === 'ACCOUNT');
    const acctWithZero = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: DATE,
      rows: mergeMetaCampaigns(spent, [{ id: 'c2', name: 'Z' }]),
    }).find((r) => r.entityLevel === 'ACCOUNT');

    expect(acctWithZero.spendMinor).toBe(acctNoZero.spendMinor); // zero-spend adds nothing
  });
});
