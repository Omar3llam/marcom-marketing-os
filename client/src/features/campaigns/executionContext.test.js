// ============================================================
// executionContext — the arithmetic behind "where to execute"
// ------------------------------------------------------------
// Pure, so every test is the same two questions: does it compute the real
// number, and does it stay SILENT (null / []) rather than describe a gap the
// data cannot support? The silences are the load-bearing half — a confident
// sentence built on one reporting ad set is worse than no sentence at all.
//
// Choosing WHICH ad set is no longer here. The server ranks; this module
// describes the row it named.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  ACTIONABLE_VERDICTS,
  MIN_SPEND_FOR_DIAGNOSIS,
  spendConcentration,
  formatGap,
  gapMagnitude,
  buildEvidenceBullets,
  buildHypothesis,
  shouldRequestEvidence,
  EVIDENCE_REFUSAL_LABELS,
  refusalLabel,
} from './executionContext.js';
import { FATIGUE_FREQ } from './verdictEvidence.js';

// 0.0164 = the campaign rate used throughout; 0.0032 sits 80% below it.
const CAMPAIGN_CTR = 0.0164;

const adSet = (over = {}) => ({
  entityId: 'as-1', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0164, spendMinor: 100_00, currency: 'USD', ...over,
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

// ── buildHypothesis ──────────────────────────────────────────────────────────
// The riskiest function in this feature: it is the only one that says what a
// number MEANS rather than what it IS. So the tests weigh heavily toward the
// refusals — the orderings and units that keep it from labelling noise.
describe('buildHypothesis — nothing to explain', () => {
  const delivering = { impressions: 500_000, spendMinor: 325_500, currency: 'USD', ctr: 0.005, frequency: 4.2 };

  it('no ad set at all', () => {
    expect(buildHypothesis(null)).toBeNull();
  });

  it.each([[0], [null], [undefined]])('impressions %s — nothing was delivered', (impressions) => {
    expect(buildHypothesis({ ...delivering, impressions })).toBeNull();
  });

  // THE ONE THIS GATE EXISTS FOR. A stopped ad set with a saturated frequency
  // and a dead CTR is not a tired creative — it is a stopped ad set. Before the
  // status passthrough every entity was written as ACTIVE on every sync, so this
  // shape confidently returned "Creative fatigue" on an ad set nobody was
  // running. It has real impressions, so the proxy below would NOT catch it.
  it.each([['PAUSED'], ['ARCHIVED']])('a %s ad set is not diagnosed, however bad its numbers', (status) => {
    expect(buildHypothesis({ ...delivering, status })).toBeNull();
  });

  it('ACTIVE with real delivery is still diagnosed', () => {
    expect(buildHypothesis({ ...delivering, status: 'ACTIVE' })?.label).toBe('Creative fatigue');
  });

  // The column is NOT NULL and defaults to ACTIVE, so ACTIVE is not positive
  // evidence of delivery — an unknown status must behave exactly like today.
  it.each([[null], [undefined]])('an unknown status (%s) falls through to the impressions proxy', (status) => {
    expect(buildHypothesis({ ...delivering, status })?.label).toBe('Creative fatigue');
    expect(buildHypothesis({ ...delivering, status, impressions: 0 })).toBeNull();
  });

  it('a paused ad set is refused BEFORE the insufficient-data gate', () => {
    expect(buildHypothesis({ ...delivering, status: 'PAUSED', spendMinor: 10 })).toBeNull();
  });

  it.each([
    ['no CTR', { ctr: null }],
    ['no frequency', { frequency: null }],
  ])('%s — the pattern gates need both figures', (_label, over) => {
    expect(buildHypothesis({ ...delivering, ...over })).toBeNull();
  });
});

describe('buildHypothesis — H3 runs before the pattern gates', () => {
  const thin = { impressions: 500_000, spendMinor: 4_999, currency: 'USD' };

  // The whole point of the ordering: a thin ad set must never collect a
  // confident pattern label. Both of these would otherwise be H1 and H2.
  it('a fatigue-shaped ad set under the floor is Insufficient data, not H1', () => {
    const h = buildHypothesis({ ...thin, ctr: 0.005, frequency: 5.0 });
    expect(h.label).toBe('Insufficient data');
  });

  it('a low-CTR ad set under the floor is Insufficient data, not H2', () => {
    const h = buildHypothesis({ ...thin, ctr: 0.005, frequency: 1.2 });
    expect(h.label).toBe('Insufficient data');
  });

  it('at the floor exactly, the pattern gates take over', () => {
    const h = buildHypothesis({ ...thin, spendMinor: MIN_SPEND_FOR_DIAGNOSIS, ctr: 0.005, frequency: 5.0 });
    expect(h.label).toBe('Creative fatigue');
    expect(MIN_SPEND_FOR_DIAGNOSIS).toBe(5_000);
  });

  it('quotes the spend as money, never as raw minor units', () => {
    const h = buildHypothesis({ ...thin, ctr: 0.005, frequency: 1.2 });
    expect(h.observed).toBe('This ad set has spent $49.99.');
    expect(h.observed).not.toMatch(/4999|minor units/);
  });

  it('offers waiting, not acting', () => {
    const h = buildHypothesis({ ...thin, ctr: 0.005, frequency: 1.2 });
    expect(h.caveat).toBe('Wait for more delivery before acting.');
  });

  // An unreported spend is not evidence of thin delivery — impressions and
  // frequency still stand on their own.
  it('an unreported spend does not trigger the floor', () => {
    const h = buildHypothesis({ impressions: 500_000, spendMinor: null, ctr: 0.005, frequency: 5.0 });
    expect(h.label).toBe('Creative fatigue');
  });
});

describe('buildHypothesis — H1 creative fatigue', () => {
  const base = { impressions: 500_000, spendMinor: 325_500, currency: 'USD' };

  it('fires when frequency is past the ceiling AND CTR is low', () => {
    expect(buildHypothesis({ ...base, ctr: 0.005, frequency: 3.6 }).label).toBe('Creative fatigue');
  });

  // THE UNIT TRAP. The verdict engine's own ctr is a PERCENT, so its fatigue
  // rule reads `ctr < 1.0`. Lifted onto a snapshot row — where 1.64% arrives as
  // 0.0164 — that rule would mean "CTR below 100%" and every ad set on the
  // platform would read as fatigued. A row carrying 1.64 must NOT be low.
  it('a CTR in PERCENT units is not mistaken for a low ratio', () => {
    const h = buildHypothesis({ ...base, ctr: 1.64, frequency: 3.6 });
    expect(h.label).not.toBe('Creative fatigue');
  });

  it('frequency below the ceiling is not fatigue, however low the CTR', () => {
    expect(buildHypothesis({ ...base, ctr: 0.001, frequency: 3.4 }).label).toBe('No fatigue signal detected');
  });

  it('a healthy CTR is not fatigue, however high the frequency', () => {
    expect(buildHypothesis({ ...base, ctr: 0.015, frequency: 4.0 }).label).toBe('No fatigue signal detected');
  });

  it('observed quotes the frequency, the threshold, and the CTR as a percent', () => {
    const h = buildHypothesis({ ...base, ctr: 0.005, frequency: 4.2 });
    expect(h.observed).toBe("Frequency is 4.2, above Lumi's fatigue threshold (3.5), while CTR is 0.50%.");
    expect(h.observed).not.toMatch(/0\.005/); // never the raw ratio
  });

  it('hedges the interpretation rather than asserting the cause', () => {
    const h = buildHypothesis({ ...base, ctr: 0.005, frequency: 4.2 });
    expect(h.interpretation).toMatch(/most commonly associated with/);
    expect(h.caveat).toBe('Refresh the creative before pausing the ad set.');
  });

  it('uses the shared FATIGUE_FREQ rather than a second copy of 3.5', () => {
    expect(FATIGUE_FREQ).toBe(3.5);
    expect(buildHypothesis({ ...base, ctr: 0.005, frequency: FATIGUE_FREQ }).label).toBe('Creative fatigue');
  });
});

describe('buildHypothesis — H2 no fatigue signal', () => {
  const base = { impressions: 500_000, spendMinor: 325_500, currency: 'USD' };

  it('names two candidate causes because the data cannot separate them', () => {
    const h = buildHypothesis({ ...base, ctr: 0.005, frequency: 1.8 });
    expect(h.label).toBe('No fatigue signal detected');
    expect(h.interpretation).toBe(
      'This pattern is more commonly associated with audience fit, creative quality, or offer relevance.',
    );
    expect(h.caveat).toBe('Review the creative and audience targeting before pausing.');
  });

  it('says the frequency is below the threshold when it is', () => {
    const h = buildHypothesis({ ...base, ctr: 0.005, frequency: 1.8 });
    expect(h.observed).toBe('CTR is 0.50% and frequency is 1.8 (below the 3.5 fatigue threshold).');
  });

  // The false-statement trap: H2 also catches a HIGH frequency paired with a
  // healthy CTR. Printing "(below the 3.5 fatigue threshold)" about a 4.0 would
  // be a plain falsehood under a heading that promises observed fact.
  it('never calls a frequency ABOVE the threshold "below" it', () => {
    const h = buildHypothesis({ ...base, ctr: 0.015, frequency: 4.0 });
    expect(h.observed).toMatch(/frequency is 4\.0 \(above the 3\.5 fatigue threshold\)/);
    expect(h.observed).not.toMatch(/below the 3\.5/);
    expect(h.observed).toMatch(/not low enough to read as fatigue/);
  });
});

// Replaces `hasExecutionContext`, which answered two questions at once. The
// ranking half is the server's now; only the verdict half stays local.
describe('shouldRequestEvidence — the local half of the old guard', () => {
  const campaign = { ctr: CAMPAIGN_CTR, spendMinor: 6553 };

  it.each(ACTIONABLE_VERDICTS)('%s is worth asking about → true', (verdict) => {
    expect(shouldRequestEvidence(campaign, verdict)).toBe(true);
  });

  it.each([['HOLD'], ['SCALE'], ['WATCH'], ['REFRESH'], [null], [undefined]])(
    '%s is not actionable → false', (verdict) => {
      expect(shouldRequestEvidence(campaign, verdict)).toBe(false);
    });

  it('no campaign → false', () => {
    expect(shouldRequestEvidence(null, 'KILL')).toBe(false);
  });

  // The point of keeping this predicate at all: it bounds request volume. An
  // expanded HOLD must cost nothing.
  it('gates the request, so a non-actionable verdict never reaches the network', () => {
    expect(shouldRequestEvidence(campaign, 'HOLD')).toBe(false);
    expect(shouldRequestEvidence(campaign, 'KILL')).toBe(true);
  });

  // It deliberately does NOT look at ad sets. The old predicate returned false
  // for a campaign with a flat spread; that answer now comes back from the
  // server as NO_MEANINGFUL_GAP, with a sentence, instead of a silent absence.
  it('is not a function of the ad-set data — that question moved to the server', () => {
    expect(shouldRequestEvidence.length).toBe(2);
    expect(shouldRequestEvidence({ ctr: null }, 'KILL')).toBe(true);
  });
});

describe('EVIDENCE_REFUSAL_LABELS — the server speaks keys, the client speaks sentences', () => {
  const ALL_KEYS = [
    'INSUFFICIENT_REPORTING_ADSETS', 'INSUFFICIENT_REPORTING_ADS',
    'BASELINE_UNAVAILABLE', 'NO_MEANINGFUL_GAP', 'INVALID_METRIC',
  ];

  it('covers every reasonKey the endpoint can emit', () => {
    for (const key of ALL_KEYS) {
      expect(EVIDENCE_REFUSAL_LABELS[key]).toEqual(expect.any(Function));
      expect(refusalLabel(key)).toEqual(expect.any(String));
    }
  });

  it('names the missing INPUT, distinctly per key', () => {
    const sentences = ALL_KEYS.map((k) => refusalLabel(k));
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('falls back to a general sentence for a key it has never seen', () => {
    // A server that gains a reason key must not render an empty line here.
    expect(refusalLabel('SOMETHING_NEW')).toBe('Not enough data to compare ad sets');
    expect(refusalLabel(null)).toBe('Not enough data to compare ad sets');
  });

  it('a healthy spread does not read as a failure', () => {
    // NO_MEANINGFUL_GAP is good news about a real campaign. The sentence must
    // not be phrased as a shortfall on the account's part.
    expect(refusalLabel('NO_MEANINGFUL_GAP')).toBe('No ad set is measurably behind the others');
  });
});

// ── The same key, one level down ────────────────────────────
// The server publishes ONE reason enum for both dimensions, so the ad-level
// surface reuses these exact keys. Two of the sentences name the entities
// involved, and rendering the ad-set nouns under a list of ADS would be a true
// refusal about the wrong entity — "no ad set is measurably behind the others"
// printed where the reader is looking at four ads.
describe('refusalLabel — the noun follows the level', () => {
  it.each([
    ['NO_MEANINGFUL_GAP',   'No ad is measurably behind the others'],
    ['BASELINE_UNAVAILABLE', 'No ad set performance data to compare against yet'],
  ])('%s speaks about ads at the ad level', (key, sentence) => {
    expect(refusalLabel(key, 'ad')).toBe(sentence);
  });

  it('leaves the level-independent sentences alone', () => {
    // These two already name their own level in the KEY, so there is nothing to
    // swap — and swapping anyway would produce "not enough reporting ads ads".
    expect(refusalLabel('INSUFFICIENT_REPORTING_ADS', 'ad')).toBe('Not enough reporting ads to compare');
    expect(refusalLabel('INVALID_METRIC', 'ad')).toBe('That ranking metric is not supported');
  });

  it('falls back in the reader’s own vocabulary', () => {
    expect(refusalLabel('SOMETHING_NEW', 'ad')).toBe('Not enough data to compare ads');
  });

  it('defaults to the ad-set wording, so every existing caller is unchanged', () => {
    expect(refusalLabel('NO_MEANINGFUL_GAP')).toBe(refusalLabel('NO_MEANINGFUL_GAP', 'adset'));
  });

  // A dimension the server never sends must not produce a sentence built out of
  // `undefined`. It degrades to the default level rather than to a broken string.
  it('degrades an unknown dimension to the ad-set wording', () => {
    expect(refusalLabel('NO_MEANINGFUL_GAP', 'placement')).toBe('No ad set is measurably behind the others');
  });
});
