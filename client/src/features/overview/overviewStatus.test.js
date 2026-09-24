import { describe, expect, it } from 'vitest';
import { getOverviewStatus, OVERVIEW_STATUS, ACCOUNT_STATE, buildHeroNarrative } from './overviewState.js';

describe('Overview composition precedence', () => {
  it.each([
    [{ loading: true, requiredError: true }, OVERVIEW_STATUS.LOADING],
    [{ requiredError: true, optionalError: true, hasCampaigns: true }, OVERVIEW_STATUS.ERROR],
    [{ requiredUnavailable: true, optionalError: true }, OVERVIEW_STATUS.UNAVAILABLE],
    [{ optionalError: true, hasCampaigns: true }, OVERVIEW_STATUS.PARTIAL],
    [{ optionalError: true, hasCampaigns: false }, OVERVIEW_STATUS.PARTIAL],
    [{ optionalLoading: true, hasCampaigns: true }, OVERVIEW_STATUS.LOADING],
    [{ hasCampaigns: false }, OVERVIEW_STATUS.EMPTY],
    [{ hasCampaigns: true }, OVERVIEW_STATUS.COMPLETE],
  ])('classifies %j as %s', (input, expected) => {
    expect(getOverviewStatus(input)).toBe(expected);
  });

  it('removes reassuring complete copy when a valid health state is partial', () => {
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 2, partial: true })[0])
      .toBe('Available health results show performing campaigns.');
    expect(buildHeroNarrative({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 1, partial: true }))
      .not.toContain('No urgent actions today.');
  });
});
