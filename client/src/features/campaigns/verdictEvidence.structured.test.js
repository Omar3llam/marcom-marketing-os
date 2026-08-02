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
  whyBlock, confidenceDetail, isDataQualityCause,
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
      .toEqual({ label: 'Low', limitedByData: true });
  });

  it('does not blame the data when the data is fine', () => {
    expect(confidenceDetail({ confidence: 0.85, dataConfidence: 0.94 }))
      .toEqual({ label: 'High', limitedByData: false });
  });

  it('null confidence renders nothing rather than a default label', () => {
    expect(confidenceDetail({ confidence: null })).toBeNull();
    expect(confidenceDetail({})).toBeNull();
  });

  it('a missing dataConfidence is not read as thin data', () => {
    expect(confidenceDetail({ confidence: 0.7, dataConfidence: null }).limitedByData).toBe(false);
  });
});
