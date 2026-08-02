// ============================================================
// mergeMetaCampaigns — roster attributes reach DELIVERING rows (PR #307)
// ============================================================
// The premise correction behind Fix 1. `created_time` and `daily_budget` were
// already requested in CAMPAIGN_LIST_FIELDS, but merge only folded `objective`
// and `status` onto insight rows — so both were present on roster-only rows and
// `undefined` on every campaign that actually delivered, i.e. missing from 100%
// of the rows the verdict engine scores. Reading them in the normalizer without
// this fold would have landed null forever and silently disabled the days gate.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('facebook-nodejs-business-sdk', () => ({
  FacebookAdsApi: { init: vi.fn() },
  AdAccount: class {},
  default: {},
}));

import { mergeMetaCampaigns, CAMPAIGN_LIST_FIELDS } from './metaAdsService.js';

const insight = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Eid Sale',
  spend: '100', impressions: '10000', clicks: '200', ...over,
});
const roster = (over = {}) => ({
  id: 'c1', name: 'Eid Sale', status: 'ACTIVE', effective_status: 'ACTIVE',
  objective: 'OUTCOME_SALES', created_time: '2026-07-01T10:00:00+0000',
  daily_budget: '5000', ...over,
});

describe('CAMPAIGN_LIST_FIELDS', () => {
  it('still requests the attributes the fold depends on', () => {
    for (const f of ['created_time', 'daily_budget', 'objective']) {
      expect(CAMPAIGN_LIST_FIELDS).toContain(f);
    }
  });
});

describe('mergeMetaCampaigns — the fold onto delivering rows', () => {
  it('stamps created_time and daily_budget onto a row that DELIVERED', () => {
    const [row] = mergeMetaCampaigns([insight()], [roster()]);
    expect(row.created_time).toBe('2026-07-01T10:00:00+0000');
    expect(row.daily_budget).toBe('5000');
  });

  it('still stamps objective and status (the pre-existing folds are intact)', () => {
    const [row] = mergeMetaCampaigns([insight()], [roster()]);
    expect(row.objective).toBe('OUTCOME_SALES');
    expect(row.effective_status).toBe('ACTIVE');
  });

  it('a roster-only campaign carries them too — a 2-day-old campaign that has not spent still has an age', () => {
    const rows = mergeMetaCampaigns([], [roster({ id: 'c2', name: 'New' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]._rosterOnly).toBe(true);
    expect(rows[0].created_time).toBe('2026-07-01T10:00:00+0000');
  });

  it('adds NO key when Meta omitted the attribute — rows stay byte-identical', () => {
    const bare = { id: 'c1', name: 'Eid Sale' };
    const [row] = mergeMetaCampaigns([insight()], [bare]);
    expect(row).not.toHaveProperty('created_time');
    expect(row).not.toHaveProperty('daily_budget');
  });

  it('the insight row\'s OWN value always wins over the roster\'s', () => {
    const [row] = mergeMetaCampaigns([insight({ daily_budget: '99' })], [roster()]);
    expect(row.daily_budget).toBe('99');
  });

  it('unwraps the SDK _data envelope on the roster side', () => {
    const [row] = mergeMetaCampaigns([insight()], [{ _data: roster() }]);
    expect(row.created_time).toBe('2026-07-01T10:00:00+0000');
  });

  it('does not mutate the inputs', () => {
    const ins = [insight()];
    const ros = [roster()];
    const before = JSON.stringify({ ins, ros });
    mergeMetaCampaigns(ins, ros);
    expect(JSON.stringify({ ins, ros })).toBe(before);
  });

  it('an insight row with no matching roster entry passes through untouched', () => {
    const [row] = mergeMetaCampaigns([insight({ campaign_id: 'orphan' })], [roster()]);
    expect(row.campaign_id).toBe('orphan');
    expect(row).not.toHaveProperty('created_time');
  });
});
