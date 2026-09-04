// ============================================================
// verdictEvidence — structured provenance (PR #309)
// ============================================================
// These replace string-scraping with field reads. The regression they guard:
// the panel used to derive its evidence line by splitting the rationale on the
// first em-dash, so the counterfactual and the recommended action — both in the
// string — were unreachable, and a rationale whose wording changed silently
// rendered a fragment.
// ============================================================
import { describe, it, expect } from 'vitest';

import {
  evidenceRows, formatEvidenceValue, evidenceLabel,
  whyBlock, confidenceDetail, isDataQualityCause, nextActionFor,
} from './verdictEvidence.js';

const funnel = {
  signal: 'FUNNEL_DROP_POST_CLICK',
  stage: 'LPV',
  confidence: 0.82,
  evidence: [
    { metric: 'CTR', value: 2.5, benchmark: 0.8, status: 'healthy' },
    { metric: 'LPV_RATE', value: 0.4, benchmark: 0.6, status: 'weak' },
  ],
  diagnosis: 'Traffic is not reaching the landing page',
  counterfactual: 'Not a creative problem: CTR 2.50% is above the 0.8% bar for this objective.',
  action: 'Check pixel installation, page redirects, and mobile page speed',
};

describe('formatEvidenceValue — the unit contract', () => {
  it('CTR arrives already in percent and is not multiplied again', () => {
    // The engine sends clicks/impressions × 100. Treating it as a ratio would
    // render a 2.5% CTR as "0.03%".
    expect(formatEvidenceValue('CTR', 2.5)).toBe('2.50%');
  });

  it('funnel rates arrive as ratios and ARE converted', () => {
    expect(formatEvidenceValue('LPV_RATE', 0.4)).toBe('40.0%');
    expect(formatEvidenceValue('ATC_RATE', 0.0093)).toBe('0.9%');
    expect(formatEvidenceValue('CO_RATE', 0.25)).toBe('25.0%');
  });

  it('an unknown metric shows its raw number rather than a guessed unit', () => {
    expect(formatEvidenceValue('SOME_FUTURE_METRIC', 12)).toBe('12');
  });

  it('returns null for a non-number instead of rendering NaN', () => {
    expect(formatEvidenceValue('CTR', null)).toBeNull();
    expect(formatEvidenceValue('CTR', undefined)).toBeNull();
    expect(formatEvidenceValue('CTR', 'x')).toBeNull();
  });

  it('labels are marketer-facing, and unknown metrics keep their raw key', () => {
    expect(evidenceLabel('LPV_RATE')).toBe('Landing page views / clicks');
    expect(evidenceLabel('WHATEVER')).toBe('WHATEVER');
  });
});

describe('evidenceRows', () => {
  it('keeps the value AND the benchmark it was judged against', () => {
    const rows = evidenceRows(funnel);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ metric: 'LPV_RATE', value: '40.0%', benchmark: '60.0%', status: 'weak' });
  });

  it('returns [] for a null funnel — never throws, never invents a row', () => {
    expect(evidenceRows(null)).toEqual([]);
    expect(evidenceRows(undefined)).toEqual([]);
    expect(evidenceRows({})).toEqual([]);
  });

  it('drops a row whose value will not format rather than showing "unknown"', () => {
    const rows = evidenceRows({ evidence: [{ metric: 'CTR', value: null }, { metric: 'CTR', value: 1.2 }] });
    expect(rows).toHaveLength(1);
  });

  it('ignores a status the engine did not send', () => {
    const [row] = evidenceRows({ evidence: [{ metric: 'CTR', value: 1.2, status: 'bogus' }] });
    expect(row.status).toBeNull();
  });
});

describe('whyBlock — a funnel verdict must not be invisible', () => {
  it('shows for KILL and SCALE, as before', () => {
    expect(whyBlock({ verdict: 'KILL' })).toEqual({ show: true, heading: 'Why kill?' });
    expect(whyBlock({ verdict: 'SCALE' })).toEqual({ show: true, heading: 'Why scale?' });
  });

  // The SECOND copy of the actionable-verdict list, and it drifted the same way
  // the first one did. A REALLOCATE asks for an intervention but had no block to
  // render it in — so on this panel it had no reason, no next step, and (since
  // the decision lifecycle lives inside this block) no way to record that
  // anyone acted. The branch now derives from nextActionFor rather than
  // restating it, which is why this can no longer drift on its own.
  it('shows for REALLOCATE, which asks for an intervention too', () => {
    expect(whyBlock({ verdict: 'REALLOCATE' })).toEqual({ show: true, heading: 'Why reallocate?' });
  });

  it.each([['KILL'], ['SCALE'], ['REALLOCATE']])('%s gets a block wherever it asks for a step', (verdict) => {
    expect(whyBlock({ verdict }).show).toBe(nextActionFor(verdict) !== null);
  });

  it('shows for a WATCH that carries a funnel — the whole regression this fixes', () => {
    // Every funnel diagnosis is a WATCH. Under the old
    // `verdict === 'KILL' || verdict === 'SCALE'` predicate the entire funnel
    // layer would have rendered nothing at all.
    const r = whyBlock({ verdict: 'WATCH', funnel });
    expect(r.show).toBe(true);
    expect(r.heading).toBe('Where the money is going');
  });

  it('shows a distinct heading for a not-judged-yet state', () => {
    expect(whyBlock({ verdict: 'WATCH', rootCause: 'INSUFFICIENT_DATA' }))
      .toEqual({ show: true, heading: 'Not judged yet' });
    expect(whyBlock({ verdict: 'WATCH', rootCause: 'TOO_EARLY' }).heading).toBe('Not judged yet');
  });

  it('stays hidden for a plain HOLD with nothing to say', () => {
    expect(whyBlock({ verdict: 'HOLD' }).show).toBe(false);
    expect(whyBlock({})).toEqual({ show: false, heading: null });
  });

  it('a diagnosis rootCause is NOT treated as a data-quality state', () => {
    // CREATIVE_FATIGUE is a real finding about the campaign, not a gap in ours.
    expect(isDataQualityCause('CREATIVE_FATIGUE')).toBe(false);
    expect(isDataQualityCause('FUNNEL_DROP_POST_CLICK')).toBe(false);
    expect(isDataQualityCause(null)).toBe(false);
  });
});

describe('confidenceDetail — say WHY confidence is low', () => {
  it('flags when thin inputs are what is holding the number down', () => {
    expect(confidenceDetail({ confidence: 0.35, dataConfidence: 0.39 }))
      .toEqual({ label: 'Low', limitedByData: true, limitedBySignal: false });
  });

  it('does not blame the data when the data is fine', () => {
    // C-09 - the signal half is not passed here, so it is UNKNOWN rather than
    // healthy. The data claim is unchanged: measured, and not the limit.
    expect(confidenceDetail({ confidence: 0.85, dataConfidence: 0.94 }))
      .toEqual({ label: 'High', limitedByData: false, limitedBySignal: null });
  });

  it('null confidence renders nothing rather than a default label', () => {
    expect(confidenceDetail({ confidence: null })).toBeNull();
    expect(confidenceDetail({})).toBeNull();
  });

  it('a missing dataConfidence is read as UNKNOWN - neither thin nor fine', () => {
    // C-09, ruling B. This test's NAME was always right and its assertion was
    // not: `false` does not mean "not thin", it means "measured, and healthy".
    // A row whose data half was never computed rendered as a clean band, so
    // UNKNOWN read as GOOD on the confidence surface itself.
    expect(confidenceDetail({ confidence: 0.7, dataConfidence: null }).limitedByData).toBeNull();
    // And it is still not TRUE - we are not claiming the data is thin either.
    expect(confidenceDetail({ confidence: 0.7, dataConfidence: null }).limitedByData).not.toBe(true);
  });
});

// The second half of the same product. It ships on every verdict row and no
// client file read it, so "Low" could say the inputs were thin but never that
// the evidence simply did not converge — two different problems with two
// different answers, collapsed into one word.
describe('confidenceDetail — the signal half', () => {
  it('names a weak signal when the data behind it was fine', () => {
    expect(confidenceDetail({ confidence: 0.45, dataConfidence: 0.9, signalConfidence: 0.5 }))
      .toEqual({ label: 'Low', limitedByData: false, limitedBySignal: true });
  });

  it('stays quiet when both halves are healthy', () => {
    expect(confidenceDetail({ confidence: 0.82, dataConfidence: 0.9, signalConfidence: 0.91 }))
      .toEqual({ label: 'High', limitedByData: false, limitedBySignal: false });
  });

  // A PRIORITY RULE, not min(). The signal here (0.4) is worse than the data
  // (0.5) and still loses: data availability is the half an operator can act on
  // — run it longer, connect the missing source — and leading with the
  // actionable one is the useful order. min() would surface the signal and hand
  // the reader a structural finding with no next step attached.
  it('data availability takes priority over signal quality', () => {
    expect(confidenceDetail({ confidence: 0.2, dataConfidence: 0.5, signalConfidence: 0.4 }))
      .toEqual({ label: 'Low', limitedByData: true, limitedBySignal: false });
  });

  it('surfaces exactly one limiting factor, never both', () => {
    const conf = confidenceDetail({ confidence: 0.2, dataConfidence: 0.3, signalConfidence: 0.3 });
    expect([conf.limitedByData, conf.limitedBySignal].filter(Boolean)).toHaveLength(1);
  });

  // C-09 - a value that is not a finite number is UNKNOWN, and a malformed one
  // ('0.4' as a string) is not a healthy one either. Still never TRUE: we do not
  // claim a weak signal we never measured.
  it.each([[null], [undefined], [NaN], ['0.4']])('%s is UNKNOWN, never a weak signal', (signalConfidence) => {
    const flag = confidenceDetail({ confidence: 0.7, dataConfidence: 0.9, signalConfidence }).limitedBySignal;
    expect(flag).toBeNull();
    expect(flag).not.toBe(true);
  });

  // Both halves share confidenceLabel's bands, so the boundary is the same one
  // the label itself turns on — 0.6 is Medium, and Medium is not "limited".
  it('is not limited AT the band edge, only below it', () => {
    expect(confidenceDetail({ confidence: 0.6, dataConfidence: 0.9, signalConfidence: 0.6 }).limitedBySignal)
      .toBe(false);
    expect(confidenceDetail({ confidence: 0.6, dataConfidence: 0.9, signalConfidence: 0.59 }).limitedBySignal)
      .toBe(true);
  });

  // ── The band stays at 0.6, and the gap it leaves is deliberate ────────────
  // A relative upgrade stamps signalConfidence at exactly 0.6 and composes it
  // against healthy data: 0.6 × 0.8 = 0.48, a product that bands as "Low" while
  // NEITHER half is below the band. Both flags therefore read false, and the
  // label stands alone with no reason attached.
  //
  // The tempting fix is to raise this threshold to 0.7 so the signal half trips.
  // It was considered and REJECTED: the engine has no bands at all — HIGH/MEDIUM
  // live in this file and nowhere else, and MAX_CONFIDENCE is the only constant
  // the engine defines about the scale. Any threshold for what makes a HALF
  // "limiting" would be a number this UI invented and then presented as the
  // engine's finding, which is the one thing the whole confidence surface exists
  // to avoid. Under-claiming is honest; a fabricated cause is not.
  //
  // The rows this leaves unexplained are cohort verdicts, and those are now
  // answered properly with the cohort itself — CohortBlock names the group and
  // the standing — rather than with a band. This test pins the silence so it
  // stays a decision and not a bug.
  it('0.6 × 0.8: says Low and blames neither half, because it cannot tell', () => {
    expect(confidenceDetail({ confidence: 0.48, dataConfidence: 0.8, signalConfidence: 0.6 }))
      .toEqual({ label: 'Low', limitedByData: false, limitedBySignal: false });
  });

  // The panel called this with two arguments for its whole life, and one caller
  // (the funnel line) still passes rows that carry no signal half at all.
  it('two-argument callers keep the answer they always got', () => {
    expect(confidenceDetail({ confidence: 0.35, dataConfidence: 0.39 }))
      .toMatchObject({ label: 'Low', limitedByData: true });
    // C-09 - the DATA answer these callers actually read is bit-identical.
    // The signal flag they never passed is now UNKNOWN rather than a quiet
    // "healthy", which is the whole correction.
    expect(confidenceDetail({ confidence: 0.9, dataConfidence: 0.9 }).limitedByData).toBe(false);
    expect(confidenceDetail({ confidence: 0.9, dataConfidence: 0.9 }).limitedBySignal).toBeNull();
  });
});
