// ============================================================
// metaNormalize — funnel extraction (PR #307)
// ============================================================
// The whole point: Meta already sends landing_page_view / add_to_cart /
// initiate_checkout in the SAME response we pay for, and the normalizer used to
// read one action type out of it and drop the rest. These prove the funnel now
// lands, that overlapping purchase aliases are not double-counted, and that
// "no funnel data" stays distinguishable from "a measured zero".
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { extractActionMetrics, collapseActions, metaNormalize } from './metaNormalize.js';

const a = (action_type, value) => ({ action_type, value: String(value) });

describe('extractActionMetrics — the funnel Meta was already sending', () => {
  it('lands landing_page_view as lpv', () => {
    expect(extractActionMetrics([a('landing_page_view', 120)], [])).toMatchObject({ lpv: 120 });
  });

  it('lands add_to_cart as atc and initiate_checkout as checkout', () => {
    const m = extractActionMetrics([a('add_to_cart', 40), a('initiate_checkout', 17)], []);
    expect(m).toMatchObject({ atc: 40, checkout: 17 });
  });

  it('lands the whole funnel from one response', () => {
    const m = extractActionMetrics([
      a('landing_page_view', 120), a('add_to_cart', 40),
      a('initiate_checkout', 17), a('purchase', 10), a('lead', 12),
    ], []);
    expect(m).toEqual({ lpv: 120, atc: 40, checkout: 17, purchase: 10, lead: 12 });
  });

  it('carries action_values under a Value suffix, separate from the counts', () => {
    const m = extractActionMetrics([a('purchase', 10)], [a('purchase', 500)]);
    expect(m).toMatchObject({ purchase: 10, purchaseValue: 500 });
  });

  it('takes the MAX across overlapping purchase aliases — never the sum', () => {
    // omni_purchase is Meta's cross-surface aggregate and already CONTAINS the
    // pixel purchases. Summing would double-count and inflate ROAS — the exact
    // "CAPI without dedup" defect. Max takes the most inclusive single measure.
    const m = extractActionMetrics([
      a('offsite_conversion.fb_pixel_purchase', 6), a('omni_purchase', 10),
    ], []);
    expect(m.purchase).toBe(10);
    expect(m.purchase).not.toBe(16);
  });

  it('is order-independent — the old .find() depended on Meta\'s array order', () => {
    const forward = extractActionMetrics([a('purchase', 4), a('omni_purchase', 9)], []);
    const reverse = extractActionMetrics([a('omni_purchase', 9), a('purchase', 4)], []);
    expect(forward).toEqual(reverse);
  });

  it('ignores an unknown action_type instead of throwing', () => {
    expect(() => extractActionMetrics([a('some_future_meta_event', 5)], [])).not.toThrow();
    expect(extractActionMetrics([a('some_future_meta_event', 5)], [])).toBeNull();
  });

  it('extracts a future action type the moment it is added to the map', () => {
    // The map is the only thing that changes when a platform adds an event —
    // no migration, because storage is a JSONB bag.
    expect(collapseActions([a('video_p95_watched_actions', 7)])).toMatchObject({ video95: 7 });
  });

  it('returns null — not {} — for an empty actions array', () => {
    // null means "this channel reported no funnel"; {} would read as "every stage
    // measured zero", which is a drop-off claim we never observed.
    expect(extractActionMetrics([], [])).toBeNull();
    expect(extractActionMetrics()).toBeNull();
  });

  it('survives a non-array (Meta omitting the field entirely)', () => {
    expect(extractActionMetrics(undefined, null)).toBeNull();
    expect(collapseActions('not-an-array')).toEqual({});
  });
});

describe('metaNormalize — funnel + entity attributes reach the snapshot row', () => {
  const rows = [{
    campaign_id: 'c1', campaign_name: 'Eid Sale',
    spend: '100.00', impressions: '10000', clicks: '200',
    actions: [a('landing_page_view', 150), a('add_to_cart', 20), a('purchase', 5)],
    action_values: [a('purchase', 900)],
    objective: 'OUTCOME_SALES',
    created_time: '2026-07-01T10:00:00+0000',
    daily_budget: '5000',
  }];

  const campaignOf = (out) => out.find((r) => r.entityLevel === 'CAMPAIGN');

  it('lands the funnel bag on the campaign row', () => {
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(campaignOf(out).actionMetrics).toMatchObject({ lpv: 150, atc: 20, purchase: 5, purchaseValue: 900 });
  });

  it('lands platformCreatedTime as a real Date', () => {
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(campaignOf(out).platformCreatedTime).toBeInstanceOf(Date);
    expect(campaignOf(out).platformCreatedTime.toISOString()).toBe('2026-07-01T10:00:00.000Z');
  });

  it('passes daily_budget through WITHOUT a ×100 conversion', () => {
    // Meta serves budgets in the account currency's SMALLEST unit already —
    // unlike `spend`, which is major units. Multiplying would store 5000 piastres
    // as 500000, i.e. every budget 100× too large.
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(campaignOf(out).dailyBudgetMinor).toBe(5000);
    // …while spend DID convert: 100.00 EGP → 10000 piastres.
    expect(campaignOf(out).spendMinor).toBe(10000);
  });

  it('leaves the new fields null when Meta reported none (never a fabricated 0/{})', () => {
    const bare = [{ campaign_id: 'c2', campaign_name: 'Bare', spend: '10', impressions: '100', clicks: '2' }];
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows: bare });
    const c = campaignOf(out);
    expect(c.actionMetrics).toBeNull();
    expect(c.dailyBudgetMinor).toBeNull();
    expect(c.platformCreatedTime).toBeNull();
  });

  it('does not throw on a malformed created_time — lands null, never Invalid Date', () => {
    const bad = [{ campaign_id: 'c3', campaign_name: 'Bad', spend: '10', impressions: '100', clicks: '2', created_time: 'not-a-date' }];
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows: bad });
    expect(campaignOf(out).platformCreatedTime).toBeNull();
  });

  it('revenue is unchanged by the max rule when only one purchase alias is present', () => {
    // Guards the regression risk of touching actionValue: the common single-alias
    // case must produce exactly what it produced before.
    const out = metaNormalize({ accountExternalId: 'act_1', currency: 'EGP', date: new Date('2026-08-01'), rows });
    expect(campaignOf(out).revenueMinor).toBe(90000); // 900.00 EGP
    expect(campaignOf(out).conversions).toBe(5);
  });
});
