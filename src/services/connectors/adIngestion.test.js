// ============================================================
// Ad-level ingestion — merge, normalize, and the partition invariant
// ============================================================
// The AD/CREATIVE levels existed in every enum and in snapshotSink's LEVEL_MODEL
// from the start, with no writer. These cover the writer.
//
// The load-bearing test is the THREE-WAY PARTITION: an ad insight row carries
// `adset_id` (its parent link) as well as `ad_id`, so a partition keyed on
// `adset_id` swallows every ad and normalizes it as a phantom ad-set.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('facebook-nodejs-business-sdk', () => ({
  FacebookAdsApi: { init: vi.fn() }, AdAccount: class {}, default: {},
}));

import { mergeMetaAds, AD_INSIGHT_FIELDS, AD_LIST_FIELDS, ADSET_INSIGHT_FIELDS } from '../metaAdsService.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { toEntityOps, dropOrphans } from './snapshotSink.js';

const adInsight = (over = {}) => ({
  ad_id: 'a1', ad_name: 'Carousel #4', adset_id: 'as1', campaign_id: 'c1',
  spend: '100.00', impressions: '10000', clicks: '250', ...over,
});
const adRoster = (over = {}) => ({
  id: 'a1', name: 'Carousel #4', adset_id: 'as1',
  status: 'ACTIVE', effective_status: 'ACTIVE',
  created_time: '2026-07-20T09:00:00+0000', ...over,
});

describe('AD field constants', () => {
  it('AD_INSIGHT_FIELDS is a SEPARATE frozen constant, not a copy of the ad-set list', () => {
    // Sharing a mutable list between levels is how the dropped-action_values
    // regression came back once already.
    expect(Object.isFrozen(AD_INSIGHT_FIELDS)).toBe(true);
    expect(AD_INSIGHT_FIELDS).not.toBe(ADSET_INSIGHT_FIELDS);
    expect(AD_INSIGHT_FIELDS).toContain('ad_id');
    expect(AD_INSIGHT_FIELDS).toContain('adset_id');   // the parent link
    expect(AD_INSIGHT_FIELDS).toContain('action_values');
  });

  it('AD_LIST_FIELDS requests created_time — creative age has no other source', () => {
    expect(AD_LIST_FIELDS).toContain('created_time');
    expect(AD_LIST_FIELDS).toContain('adset_id');
  });
});

describe('mergeMetaAds', () => {
  it('an insight row wins over its roster twin', () => {
    const rows = mergeMetaAds([adInsight()], [adRoster()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe('100.00');
    expect(rows[0]._rosterOnly).toBeUndefined();
  });

  it('folds created_time onto a DELIVERING ad, not only a dormant one', () => {
    // The campaign-level version of this bug shipped once: the attribute lives
    // on the roster edge only, so without the fold it is undefined on every ad
    // that actually delivered — i.e. missing from exactly the rows worth judging.
    const [row] = mergeMetaAds([adInsight()], [adRoster()]);
    expect(row.created_time).toBe('2026-07-20T09:00:00+0000');
  });

  it('a non-delivering ad becomes a roster-only row with zero-ish placeholders', () => {
    const rows = mergeMetaAds([], [adRoster({ id: 'a2', name: 'New' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ad_id: 'a2', _rosterOnly: true, spend: '0', impressions: '0' });
    expect(rows[0].created_time).toBe('2026-07-20T09:00:00+0000');
  });

  it('merges status from the roster', () => {
    const [row] = mergeMetaAds([adInsight()], [adRoster({ effective_status: 'PAUSED' })]);
    expect(row.effective_status).toBe('PAUSED');
  });

  it('drops an insight row with no ad_id rather than throwing', () => {
    expect(() => mergeMetaAds([{ spend: '1' }], [])).not.toThrow();
    expect(mergeMetaAds([{ spend: '1' }], [])).toHaveLength(0);
  });

  it('drops a roster ad with no adset_id — a parentless FK would be garbage', () => {
    const rows = mergeMetaAds([], [adRoster({ id: 'a3', adset_id: undefined })]);
    expect(rows).toHaveLength(0);
  });

  it('unwraps the SDK _data envelope on both sides', () => {
    const rows = mergeMetaAds([{ _data: adInsight() }], [{ _data: adRoster() }]);
    expect(rows[0].ad_id).toBe('a1');
  });

  it('does not mutate its inputs', () => {
    const ins = [adInsight()]; const ros = [adRoster()];
    const before = JSON.stringify({ ins, ros });
    mergeMetaAds(ins, ros);
    expect(JSON.stringify({ ins, ros })).toBe(before);
  });
});

// ── The invariant ───────────────────────────────────────────────────────────
describe('THREE-WAY PARTITION — most-specific key first', () => {
  const campaignRow = { campaign_id: 'c1', campaign_name: 'Eid', spend: '500', impressions: '90000', clicks: '2000' };
  const adSetRow    = { adset_id: 'as1', adset_name: 'Broad', campaign_id: 'c1', spend: '300', impressions: '50000', clicks: '1200' };
  const adRow       = adInsight();

  const run = () => metaNormalize({
    accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'),
    rows: [campaignRow, adSetRow, adRow],
  });
  const byLevel = (out, lvl) => out.filter((r) => r.entityLevel === lvl);

  it('routes each row to exactly one level', () => {
    const out = run();
    expect(byLevel(out, 'CAMPAIGN')).toHaveLength(1);
    expect(byLevel(out, 'ADSET')).toHaveLength(1);
    expect(byLevel(out, 'AD')).toHaveLength(1);
  });

  it('a row with BOTH ad_id and adset_id is an AD — never an ad-set', () => {
    // The whole point. `adset_id` on an ad row is its PARENT link.
    const out = run();
    expect(byLevel(out, 'AD')[0].externalId).toBe('a1');
    expect(byLevel(out, 'ADSET').map((r) => r.externalId)).toEqual(['as1']);
    expect(byLevel(out, 'ADSET').map((r) => r.externalId)).not.toContain('a1');
  });

  it('the ad does NOT shadow its own parent ad-set', () => {
    const out = run();
    const adSet = byLevel(out, 'ADSET')[0];
    expect(adSet.spendMinor).toBe(30000);      // the ad-set's own 300.00, untouched
    expect(byLevel(out, 'AD')[0].spendMinor).toBe(10000); // the ad's own 100.00
  });

  it('the account rollup still sums CAMPAIGNS only — ads are a subset twice over', () => {
    const account = run().find((r) => r.entityLevel === 'ACCOUNT');
    expect(account.spendMinor).toBe(50000); // 500.00, not 500+300+100
  });
});

describe('normalizeAds', () => {
  const one = (over = {}) => metaNormalize({
    accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'),
    rows: [adInsight(over)],
  }).find((r) => r.entityLevel === 'AD');

  it('maps ad_id → externalId and adset_id → parentExternalId', () => {
    expect(one()).toMatchObject({ externalId: 'a1', entityLevel: 'AD', parentExternalId: 'as1' });
  });

  it('lands platformCreatedTime as a real Date', () => {
    const r = one({ created_time: '2026-07-20T09:00:00+0000' });
    expect(r.platformCreatedTime).toBeInstanceOf(Date);
    expect(r.platformCreatedTime.toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('platformCreatedTime is null when Meta reported none — never a fabricated date', () => {
    expect(one().platformCreatedTime).toBeNull();
  });

  it('maps Meta status through toEntityStatus, not raw — the column is a Prisma enum', () => {
    // A raw 'ADSET_PAUSED' would throw on the upsert; an unknown state is null.
    expect(one({ effective_status: 'ADSET_PAUSED' }).status).toBe('PAUSED');
    expect(one({ effective_status: 'PENDING_REVIEW' }).status).toBeNull();
  });

  it('extracts the funnel — including the video quartiles that only matter here', () => {
    const r = one({
      actions: [
        { action_type: 'video_view', value: '4000' },
        { action_type: 'video_p25_watched_actions', value: '1800' },
        { action_type: 'video_p95_watched_actions', value: '300' },
        { action_type: 'landing_page_view', value: '200' },
      ],
    });
    expect(r.actionMetrics).toMatchObject({ videoView: 4000, video25: 1800, video95: 300, lpv: 200 });
  });

  it('preserves the rosterOnly flag so the sink writes no fabricated zero snapshot', () => {
    expect(one({ _rosterOnly: true }).rosterOnly).toBe(true);
  });

  it('drops an ad with no adset_id — no resolvable parent', () => {
    const out = metaNormalize({
      accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'),
      rows: [adInsight({ adset_id: undefined })],
    });
    expect(out.filter((r) => r.entityLevel === 'AD')).toHaveLength(0);
  });
});

// ── Orphan handling ─────────────────────────────────────────────────────────
describe('dropOrphans — an orphan must not roll back the whole sync', () => {
  const WS = '11111111-1111-1111-1111-111111111111';
  const ops = (normalized) => toEntityOps(WS, 'META', normalized);

  const norm = (over) => ({
    externalId: 'x', entityLevel: 'AD', parentExternalId: 'as-missing', name: 'Ad',
    spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0, ...over,
  });

  it('toEntityOps itself drops nothing — the check needs DB knowledge it does not have', () => {
    expect(ops([norm()])).toHaveLength(1);
  });

  it('an ad whose ad-set is in neither the batch nor the DB is dropped', () => {
    const kept = dropOrphans(ops([norm()]), new Set());
    expect(kept).toHaveLength(0);
  });

  it('the SAME ad is kept when its parent already exists in the DB', () => {
    // FK validity is a property of the database, not the batch. A batch-only
    // check would trade a rare crash for routine silent data loss.
    const all = ops([norm()]);
    const kept = dropOrphans(all, new Set([all[0].parentId]));
    expect(kept).toHaveLength(1);
  });

  it('an ad whose ad-set is in the same batch is kept', () => {
    const out = metaNormalize({
      accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'),
      rows: [
        { campaign_id: 'c1', campaign_name: 'Eid', spend: '500', impressions: '9000', clicks: '200' },
        { adset_id: 'as1', adset_name: 'Broad', campaign_id: 'c1', spend: '300', impressions: '5000', clicks: '120' },
        adInsight(),
      ],
    });
    const kept = dropOrphans(ops(out), new Set());
    expect(kept.map((o) => o.level)).toEqual(expect.arrayContaining(['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD']));
  });

  it('dropping cascades — a whole missing subtree goes, never half of it', () => {
    const all = ops([
      norm({ externalId: 'as-orphan', entityLevel: 'ADSET', parentExternalId: 'c-missing', name: 'AdSet' }),
      norm({ externalId: 'ad-child', entityLevel: 'AD', parentExternalId: 'as-orphan', name: 'Ad' }),
    ]);
    expect(dropOrphans(all, new Set())).toHaveLength(0);
  });

  it('the account level is never an orphan — it has no parent', () => {
    const all = ops([{
      externalId: 'act_1', entityLevel: 'ACCOUNT', parentExternalId: null, name: 'Acct',
      spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
    }]);
    expect(dropOrphans(all, new Set())).toHaveLength(1);
  });
});

describe('toEntityOps — platformCreatedTime reaches the Ad model', () => {
  const WS = '11111111-1111-1111-1111-111111111111';
  const when = new Date('2026-07-20T09:00:00Z');

  it('stamps it at AD level (it was CAMPAIGN-only — the column would have stayed null forever)', () => {
    const [op] = toEntityOps(WS, 'META', [{
      externalId: 'a1', entityLevel: 'AD', parentExternalId: 'as1', name: 'Ad',
      platformCreatedTime: when,
      spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
    }]);
    expect(op.data.platformCreatedTime).toEqual(when);
  });

  it('does NOT stamp it at ADSET level — that model has no such column and Prisma throws on unknown args', () => {
    const [op] = toEntityOps(WS, 'META', [{
      externalId: 'as1', entityLevel: 'ADSET', parentExternalId: 'c1', name: 'AdSet',
      platformCreatedTime: when,
      spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
    }]);
    expect(op.data).not.toHaveProperty('platformCreatedTime');
  });
});
