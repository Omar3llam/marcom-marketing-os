// ============================================================
// executionContext — the arithmetic behind "where to execute"
// ------------------------------------------------------------
// Pure, so every test is the same two questions: does it compute the real
// number, and does it stay SILENT (null / []) rather than name a worst ad set
// the data cannot support? The silences are the load-bearing half — a confident
// pick built on one reporting ad set is worse than no pick at all.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  ACTIONABLE_VERDICTS,
  MIN_MEANINGFUL_GAP,
  findWorstAdSet,
  spendConcentration,
  formatGap,
  gapMagnitude,
  buildEvidenceBullets,
  hasExecutionContext,
} from './executionContext.js';

// 0.0164 = the campaign rate used throughout; 0.0032 sits 80% below it.
const CAMPAIGN_CTR = 0.0164;

const adSet = (over = {}) => ({
  entityId: 'as-1', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0164, spendMinor: 100_00, currency: 'USD', ...over,
});

describe('findWorstAdSet — when it stays silent', () => {
  it('a single ad set is not a comparison', () => {
    expect(findWorstAdSet([adSet({ ctr: 0.0032 })], CAMPAIGN_CTR)).toBeNull();
  });

  it('no ad sets at all', () => {
    expect(findWorstAdSet([], CAMPAIGN_CTR)).toBeNull();
  });

  it.each([[null], [undefined], ['nope']])('a non-array (%s) is null, not a throw', (input) => {
    expect(findWorstAdSet(input, CAMPAIGN_CTR)).toBeNull();
  });

  // No baseline means no gap — every campaign figure here would be a division
  // by something that was never measured.
  it.each([[null], [undefined], [0], [Number.NaN]])('a campaign CTR of %s gives no baseline', (ctr) => {
    expect(findWorstAdSet([adSet({ ctr: 0.0032 }), adSet({ entityId: 'as-2' })], ctr)).toBeNull();
  });

  it('ad sets that all report no CTR', () => {
    const rows = [adSet({ ctr: null }), adSet({ entityId: 'as-2', ctr: null })];
    expect(findWorstAdSet(rows, CAMPAIGN_CTR)).toBeNull();
  });

  // The trap: 5 ad sets, ONE reporting. It is trivially the lowest — and also
  // the highest. Calling it "lowest in campaign" would be true and meaningless.
  it('only ONE ad set reports a CTR — trivially the min AND the max', () => {
    const rows = [adSet({ ctr: 0.0032 }), adSet({ entityId: 'as-2', ctr: null }), adSet({ entityId: 'as-3', ctr: null })];
    expect(findWorstAdSet(rows, CAMPAIGN_CTR)).toBeNull();
  });

  // 12% under the campaign rate is ordinary spread between ad sets.
  it('a gap shallower than 20% is variance, not a finding', () => {
    const rows = [adSet({ ctr: 0.0144 }), adSet({ entityId: 'as-2', ctr: 0.0180 })];
    expect(findWorstAdSet(rows, CAMPAIGN_CTR)).toBeNull();
  });

  // Brackets the threshold rather than sitting ON it: `CAMPAIGN_CTR * 0.8`
  // lands at -0.19999999999999998 in float, so an exact-boundary assertion
  // would be testing IEEE 754, not the rule.
  it('brackets the threshold — 20.1% below fires, 19.9% below does not', () => {
    const other = adSet({ entityId: 'as-2', ctr: 0.0180 });
    expect(findWorstAdSet([adSet({ ctr: 0.01310 }), other], CAMPAIGN_CTR)?.entityId).toBe('as-1');
    expect(findWorstAdSet([adSet({ ctr: 0.01313 }), other], CAMPAIGN_CTR)).toBeNull();
    expect(MIN_MEANINGFUL_GAP).toBe(-0.20);
  });
});

describe('findWorstAdSet — when it names one', () => {
  const rows = [
    adSet({ entityId: 'as-1', name: 'Lookalike 1%', ctr: 0.0180 }),
    adSet({ entityId: 'as-2', name: 'Broad 25-45', ctr: 0.0032 }),
    adSet({ entityId: 'as-3', name: 'Retarget 30d', ctr: 0.0150 }),
  ];

  it('returns the lowest CTR, not the first row', () => {
    expect(findWorstAdSet(rows, CAMPAIGN_CTR).name).toBe('Broad 25-45');
  });

  it('carries the signed gap as a fraction', () => {
    expect(findWorstAdSet(rows, CAMPAIGN_CTR).gap).toBeCloseTo(-0.8049, 4);
  });

  it('reports how many ad sets it actually compared', () => {
    const withBlank = [...rows, adSet({ entityId: 'as-4', ctr: null })];
    expect(findWorstAdSet(withBlank, CAMPAIGN_CTR).comparedCount).toBe(3); // not 4
  });

  it('keeps the row fields the UI renders', () => {
    const worst = findWorstAdSet(rows, CAMPAIGN_CTR);
    expect(worst).toMatchObject({ entityId: 'as-2', channel: 'META', currency: 'USD', ctr: 0.0032 });
  });

  it('does not mutate the input rows', () => {
    const input = rows.map((r) => ({ ...r }));
    findWorstAdSet(input, CAMPAIGN_CTR);
    expect(input.every((r) => !('gap' in r) && !('comparedCount' in r))).toBe(true);
  });

  it('is order-independent', () => {
    const reversed = [...rows].reverse();
    expect(findWorstAdSet(reversed, CAMPAIGN_CTR).entityId)
      .toBe(findWorstAdSet(rows, CAMPAIGN_CTR).entityId);
  });

  // A measured 0% CTR is real data — an ad set that ran and got no clicks is
  // exactly the one worth looking at first.
  it('a measured 0 CTR is a valid worst, not a missing value', () => {
    const withZero = [adSet({ entityId: 'as-z', ctr: 0 }), adSet({ entityId: 'as-2', ctr: 0.0164 })];
    expect(findWorstAdSet(withZero, CAMPAIGN_CTR).entityId).toBe('as-z');
  });
});

describe('spendConcentration', () => {
  it('divides the ad set spend by the CAMPAIGN spend', () => {
    expect(spendConcentration(3255, 6553)).toBeCloseTo(0.4967, 4);
  });

  it.each([
    ['ad set spend absent', null, 6553],
    ['campaign spend absent', 3255, null],
    ['campaign spent nothing', 3255, 0],
  ])('%s → null, never 0%%', (_label, a, b) => {
    expect(spendConcentration(a, b)).toBeNull();
  });

  // A real 0 spend on the ad set is a share of zero, which is a fact.
  it('an ad set that spent nothing is 0, not null', () => {
    expect(spendConcentration(0, 6553)).toBe(0);
  });
});

describe('formatGap / gapMagnitude', () => {
  it('0.32% against a 1.64% campaign reads -80%', () => {
    expect(formatGap(0.0032, 0.0164)).toBe('-80%');
    expect(gapMagnitude(0.0032, 0.0164)).toBe(80);
  });

  it('an ad set above the campaign rate is signed +', () => {
    expect(formatGap(0.0200, 0.0164)).toBe('+22%');
  });

  it.each([
    ['ad set CTR null', null, 0.0164],
    ['campaign CTR null', 0.0032, null],
    ['campaign CTR 0', 0.0032, 0],
  ])('%s → null', (_label, a, b) => {
    expect(formatGap(a, b)).toBeNull();
    expect(gapMagnitude(a, b)).toBeNull();
  });

  it('magnitude is unsigned', () => {
    expect(gapMagnitude(0.0200, 0.0164)).toBe(22);
  });
});

describe('buildEvidenceBullets', () => {
  const worst = { ctr: 0.0032, spendMinor: 3255, comparedCount: 4 };

  it('gives three DISTINCT reasons — gap, money, sample size', () => {
    const bullets = buildEvidenceBullets(worst, 0.0164, 6553);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toMatch(/lowest ctr.*-80%/i);
    expect(bullets[1]).toBe('50% of campaign spend');
    expect(bullets[2]).toBe('Compared against 4 ad sets reporting CTR');
  });

  // Three bullets restating one fact would read as three reasons where there
  // is one. Each bullet must carry a figure the others do not.
  it('never states the CTR gap twice in different words', () => {
    const bullets = buildEvidenceBullets(worst, 0.0164, 6553);
    expect(bullets.filter((b) => /below|vs the campaign rate/i.test(b))).toHaveLength(1);
  });

  it('drops the CTR bullet when there is no baseline', () => {
    const bullets = buildEvidenceBullets(worst, null, 6553);
    expect(bullets.some((b) => /lowest ctr/i.test(b))).toBe(false);
    expect(bullets).toHaveLength(2);
  });

  it('drops the spend bullet when either spend is absent', () => {
    expect(buildEvidenceBullets({ ...worst, spendMinor: null }, 0.0164, 6553))
      .not.toContainEqual(expect.stringMatching(/campaign spend/));
    expect(buildEvidenceBullets(worst, 0.0164, null))
      .not.toContainEqual(expect.stringMatching(/campaign spend/));
  });

  it('never returns more than three', () => {
    expect(buildEvidenceBullets(worst, 0.0164, 6553).length).toBeLessThanOrEqual(3);
  });

  it('no ad set at all is an empty list, not a throw', () => {
    expect(buildEvidenceBullets(null, 0.0164, 6553)).toEqual([]);
  });
});

describe('hasExecutionContext — the table row guard', () => {
  const campaign = { ctr: CAMPAIGN_CTR, spendMinor: 6553 };
  const rows = [adSet({ ctr: 0.0032 }), adSet({ entityId: 'as-2', ctr: 0.0180 })];

  it.each(ACTIONABLE_VERDICTS)('%s with a real gap → true', (verdict) => {
    expect(hasExecutionContext(campaign, rows, verdict)).toBe(true);
  });

  it.each([['HOLD'], ['SCALE'], ['WATCH'], ['REFRESH'], [null], [undefined]])(
    '%s is not actionable → false', (verdict) => {
      expect(hasExecutionContext(campaign, rows, verdict)).toBe(false);
    });

  it('an actionable verdict with no meaningful gap → false', () => {
    const flat = [adSet({ ctr: 0.0164 }), adSet({ entityId: 'as-2', ctr: 0.0160 })];
    expect(hasExecutionContext(campaign, flat, 'KILL')).toBe(false);
  });

  it('ad sets not loaded yet → false, never a throw', () => {
    expect(hasExecutionContext(campaign, undefined, 'KILL')).toBe(false);
  });

  it('no campaign → false', () => {
    expect(hasExecutionContext(null, rows, 'KILL')).toBe(false);
  });
});
