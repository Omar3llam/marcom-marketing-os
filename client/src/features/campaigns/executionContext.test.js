import { describe, it, expect } from 'vitest';
import { ACTIONABLE_VERDICTS, shouldRequestEvidence, EVIDENCE_REFUSAL_LABELS, refusalLabel, formatEvidenceGap, formatEvidenceValue, buildRelativeBaselineReadout } from './executionContext.js';
import { nextActionFor } from './verdictEvidence.js';
const CAMPAIGN_CTR = 0.0164;

const readoutInput = () => ({ metric: 'ctr', subjectValue: 0.0091, parentValue: 0.02, gap: -0.34,
  subjectLabel: 'Ad set', parentLabel: 'Campaign', relationParentLabel: 'campaign', populationNoun: 'ad sets',
  comparisonEnvelope: { source: 'META', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
    currency: null, comparableCount: 2, excludedByEnvelopeCount: 1 } });

describe('P7-07B complete presentation model', () => {
  it('maps explicit nouns and server fields without choosing a row or recomputing a gap', () => {
    const input = readoutInput();
    const before = structuredClone(input);
    expect(buildRelativeBaselineReadout(input)).toEqual({ metricLabel: 'CTR', subjectLabel: 'Ad set',
      subjectValue: '0.91%', parentLabel: 'Campaign', parentValue: '2.00%', gap: '-34%', relation: '34% below campaign',
      basisLabel: 'Evidence · 2026-08-01 → 2026-08-30 UTC · META',
      populationLabel: 'Compared within 2 reporting ad sets with comparable evidence · 1 excluded from this comparison' });
    expect(input).toEqual(before);
  });
  it.each([undefined, null])('withholds a missing input %s', (input) => { expect(buildRelativeBaselineReadout(input)).toBeNull(); });
  it.each(['metric', 'subjectValue', 'parentValue', 'gap', 'comparisonEnvelope', 'subjectLabel', 'parentLabel',
    'relationParentLabel', 'populationNoun'])('withholds an incomplete %s', (field) => {
    expect(buildRelativeBaselineReadout({ ...readoutInput(), [field]: null })).toBeNull();
  });
  it.each(['subjectLabel', 'parentLabel', 'relationParentLabel', 'populationNoun'])('withholds blank %s', (field) => {
    expect(buildRelativeBaselineReadout({ ...readoutInput(), [field]: '  ' })).toBeNull();
  });
  it.each(['windowStart', 'windowEnd', 'source', 'comparableCount', 'excludedByEnvelopeCount'])(
    'withholds missing display content %s without inventing copy', (field) => {
      const input = readoutInput();
      delete input.comparisonEnvelope[field];
      expect(buildRelativeBaselineReadout(input)).toBeNull();
    });
  it.each([['subjectValue', NaN], ['parentValue', Infinity], ['gap', '0.34'], ['metric', 'thumbstop']])(
    'withholds unformattable %s', (field, value) => {
      expect(buildRelativeBaselineReadout({ ...readoutInput(), [field]: value })).toBeNull();
    });
  it('does not apply a new population/sample eligibility threshold', () => {
    const input = readoutInput();
    input.comparisonEnvelope.comparableCount = 1;
    expect(buildRelativeBaselineReadout(input).populationLabel).toContain('1 reporting ad sets');
  });
});

describe('published comparison formatting', () => {
  it('formats the gap without child or parent arithmetic', () => {
    expect(formatEvidenceGap(-0.34, 'campaign')).toEqual({ signed: '-34%', relation: '34% below campaign' });
    expect(formatEvidenceGap(0.42, 'ad set')).toEqual({ signed: '+42%', relation: '42% above ad set' });
    expect(formatEvidenceGap(0, 'campaign')).toEqual({ signed: '0%', relation: 'matches campaign' });
    expect(formatEvidenceGap(2.5, 'campaign').signed).toBe('+250%');
    expect(formatEvidenceGap(-0.001, 'campaign').relation).toBe('0% below campaign');
  });
  it.each([null, undefined, NaN, Infinity, '0.34'])('withholds an invalid gap %s', value => {
    expect(formatEvidenceGap(value, 'campaign')).toBeNull();
  });
  it('formats only supported metric units', () => {
    expect(formatEvidenceValue('ctr', 0.0066)).toBe('0.66%');
    expect(formatEvidenceValue('roas', 1.4)).toBe('1.40x');
    expect(formatEvidenceValue('frequency', 3.9)).toBe('3.90');
    expect(formatEvidenceValue('ctr', 0)).toBe('0.00%');
    expect(formatEvidenceValue('thumbstop', 0.1)).toBeNull();
    expect(formatEvidenceValue('constructor', 0.1)).toBeNull();
    expect(formatEvidenceValue('ctr', null)).toBeNull();
  });
});

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
    'COMPARISON_ENVELOPE_UNAVAILABLE',
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

// ============================================================
// The contract between the two gates
// ============================================================
// Two lists in two modules decide what a marketer can do about a verdict:
//
//   ACTIONABLE_VERDICTS (here)          — which verdicts get the ad-set
//                                         "where to execute" panel, and which
//                                         trigger an evidence request at all.
//   nextActionFor       (verdictEvidence) — the step a verdict asks for, and,
//                                         since the decision action moved onto
//                                         the campaign panel, the gate on
//                                         "Did you act on this?".
//
// They drifted, silently, and it cost REALLOCATE its ability to be recorded:
// the verdict was in ACTIONABLE_VERDICTS, so the ad-set panel rendered under it
// and carried the lifecycle buttons — and when those moved to the decision
// surface, which gates on nextActionFor, REALLOCATE had no entry there and lost
// the surface entirely. Nothing failed. The buttons were simply gone from the
// one verdict whose entire content is "move the money".
//
// ONE-DIRECTIONAL, deliberately. Every ACTIONABLE_VERDICT must have a next
// action, because a panel that renders under it needs a step to name. The
// converse is NOT asserted: SCALE has a next action and is deliberately not in
// ACTIONABLE_VERDICTS, because that list also decides who gets an evidence
// request and a "consider pausing it" panel — sentences written for a campaign
// that is losing money, and wrong under a winner.
describe('ACTIONABLE_VERDICTS ↔ nextActionFor', () => {
  it('every actionable verdict has a next action', () => {
    for (const verdict of ACTIONABLE_VERDICTS) {
      expect(nextActionFor(verdict), `${verdict} is actionable but asks for nothing`).toBeTruthy();
    }
  });

  it('names REALLOCATE, the member that regressed', () => {
    // Asserted separately from the loop: a future edit that empties or narrows
    // ACTIONABLE_VERDICTS would leave the loop vacuously passing.
    expect(ACTIONABLE_VERDICTS).toContain('REALLOCATE');
    expect(nextActionFor('REALLOCATE')).toBeTruthy();
  });

  it('still lists exactly the two verdicts the evidence panel is written for', () => {
    // Widening this is a product change, not a fix: it would send an evidence
    // request for more campaigns and render "its CTR is X% below the campaign
    // rate — consider pausing it" under verdicts that copy was never for.
    expect([...ACTIONABLE_VERDICTS]).toEqual(['KILL', 'REALLOCATE']);
  });

  it.each([['HOLD'], ['WATCH']])('%s asks for nothing and is not actionable', (verdict) => {
    expect(nextActionFor(verdict)).toBeNull();
    expect(ACTIONABLE_VERDICTS).not.toContain(verdict);
  });

  // REFRESH sits on OPPOSITE sides of the two gates, and that is deliberate —
  // they answer different questions and this is the case that proves it:
  //
  //   nextActionFor        → "does this verdict ask the buyer to do something?"
  //                          REFRESH: yes — swap the creative.
  //   ACTIONABLE_VERDICTS  → "should we fetch ad-set evidence for it?"
  //                          REFRESH: no — creative fatigue is a campaign-level
  //                          finding, and the evidence copy ("its CTR is X%
  //                          below the campaign rate — consider pausing it") is
  //                          written for a KILL, not for a worn-out ad.
  //
  // A future edit that "tidies" these into one list would either silence the
  // REFRESH action bar again or point a pause-flavoured alarm at a healthy
  // campaign. The disagreement is the contract.
  it('REFRESH asks for an action but is still not an evidence verdict', () => {
    expect(nextActionFor('REFRESH')).toBeTruthy();
    expect(ACTIONABLE_VERDICTS).not.toContain('REFRESH');
  });
});
