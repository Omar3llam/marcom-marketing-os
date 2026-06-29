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
import { toSnapshotRows } from './connectors/snapshotSink.js';
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

  it('empty roster → insights pass through; empty insights → all campaigns become zero-spend', () => {
    expect(mergeMetaCampaigns([{ campaign_id: 'c1', spend: '5' }], [])).toEqual([{ campaign_id: 'c1', spend: '5' }]);
    expect(mergeMetaCampaigns([], [{ id: 'c9', name: 'Solo' }])).toEqual([
      { campaign_id: 'c9', campaign_name: 'Solo', spend: '0', impressions: '0', clicks: '0' },
    ]);
  });

  it('skips roster rows without an id (cannot key them safely)', () => {
    const merged = mergeMetaCampaigns([], [{ name: 'No id' }, { id: 'c1', name: 'Ok' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].campaign_id).toBe('c1');
  });

  it('CAMPAIGN_LIST_FIELDS requests the keys metaNormalize maps + the real status', () => {
    expect(CAMPAIGN_LIST_FIELDS).toContain('id');
    expect(CAMPAIGN_LIST_FIELDS).toContain('name');
    expect(CAMPAIGN_LIST_FIELDS).toContain('effective_status');
  });
});

describe('zero-spend normalizes honestly (metaNormalize needs no change)', () => {
  it('a merged zero-spend campaign lands as a real CAMPAIGN with 0s + roas null — not skipped, not fabricated', () => {
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

    const campaigns = normalized.filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaigns).toHaveLength(2); // BOTH present — zero-spend NOT dropped
    expect(campaigns.find((r) => r.externalId === 'c2')).toMatchObject({
      spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
    });

    const zeroSnap = toSnapshotRows('ws1', 'META', normalized)
      .find((r) => r.entityLevel === 'CAMPAIGN' && r.spendMinor === 0);
    expect(zeroSnap.roas).toBeNull(); // spend 0 → roas null, never a fabricated 0.00x
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
