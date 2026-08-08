// ============================================================
// CampaignDetailPanel — "What we ruled out", and when it may appear
// ------------------------------------------------------------
// The engine has always built counterfactuals and shipped them on every verdict.
// Nothing rendered them: the panel's structured half only existed for funnel
// diagnoses, and every funnel diagnosis is a WATCH — so a KILL or SCALE, the two
// verdicts that actually cost money, showed one regex-extracted clause and
// nothing else.
//
// The gate is the interesting part, and it is disjoint by construction:
//   funnel present  → a WATCH → funnel.counterfactual (prose) renders, as before
//   funnel absent   → a KILL/SCALE → the structured block renders
// The two can never compete for the slot, which is why this could ship without
// touching the WATCH path at all.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignDetailPanel } from './CampaignDetailPanel.jsx';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

const campaign = (over = {}) => ({
  entityId: 'c1', name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 500_000, ctr: 0.007, frequency: 2.1, roas: 0.4, currency: 'EGP', ...over,
});

const COUNTERFACTUALS = [{
  mechanism: 'AUDIENCE_MISMATCH',
  labelKey: 'diagnosis.audienceMismatch',
  rejectedBy: [{ metric: 'CPC', value: 120, benchmark: 200, severity: 'HEALTHY' }],
  preferredBecause: [{ metric: 'CTR', value: 0.7, benchmark: 1.5, severity: 'CRITICAL' }],
  confidence: { reasoning: 0.4, data: 0.6 },
}];

const funnel = {
  signal: 'FUNNEL_DROP_POST_CLICK', stage: 'LPV', confidence: 0.82,
  evidence: [{ metric: 'CTR', value: 2.5, benchmark: 0.8, status: 'healthy' }],
  diagnosis: 'Traffic is not reaching the landing page',
  counterfactual: 'Not a creative problem: CTR 2.50% is above the 0.8% bar.',
  action: 'Check pixel installation',
};

const RATIONALE = 'Lowest CTR in the conversion group (0.70% vs 1.50% group average) — spend is concentrated.';

const panel = (over = {}) => render(
  <CampaignDetailPanel
    campaign={campaign()} verdict="KILL" rationale={RATIONALE}
    confidence={0.86} counterfactuals={COUNTERFACTUALS} {...over}
  />,
);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { reasoning: null, stale: false, generatedAt: null } });
});

describe('a KILL finally says what it ruled out', () => {
  it('renders the block', () => {
    panel();
    expect(screen.getByText('What we ruled out')).toBeInTheDocument();
    expect(screen.getByText('Audience mismatch')).toBeInTheDocument();
  });

  it('shows what argued against the alternative', () => {
    panel();
    expect(screen.getByText(/Cost per click was acceptable/)).toBeInTheDocument();
  });

  it('shows what the primary explanation covers instead', () => {
    panel();
    expect(screen.getByText(/CTR is below benchmark/)).toBeInTheDocument();
  });

  it('does the same for a SCALE', () => {
    panel({ verdict: 'SCALE' });
    expect(screen.getByText('What we ruled out')).toBeInTheDocument();
  });
});

// The correction to the obvious design. Suppressing the prose clause once the
// structured block renders leaves a KILL under a "Why?" heading listing only
// REJECTIONS — with nothing anywhere naming what was ruled IN. The block itself
// says "the primary explanation also covers", and this line is the only thing on
// screen that says what that explanation is.
describe('the reason survives alongside the rejections', () => {
  it('still names the primary reason', () => {
    panel();
    expect(screen.getByText(/Lowest CTR in the conversion group/)).toBeInTheDocument();
  });

  it('reads why → what we ruled out, in that order', () => {
    const { container } = panel();
    const text = container.textContent;
    expect(text.indexOf('Lowest CTR in the conversion group'))
      .toBeLessThan(text.indexOf('What we ruled out'));
  });

  it('and the ask comes last', () => {
    const { container } = panel();
    const text = container.textContent;
    expect(text.indexOf('What we ruled out')).toBeLessThan(text.indexOf('Next step:'));
  });
});

describe('the WATCH path is untouched', () => {
  // funnel only exists when a funnel STAGE was diagnosed, and every funnel
  // diagnosis is a WATCH. The two paths are disjoint, so the prose sentence
  // keeps its slot and the structured block stays away.
  it('a funnel WATCH keeps its prose counterfactual and gets no block', () => {
    panel({ verdict: 'WATCH', funnel, rootCause: 'FUNNEL_DROP_POST_CLICK' });
    expect(screen.getByText(/Not a creative problem/)).toBeInTheDocument();
    expect(screen.queryByText('What we ruled out')).not.toBeInTheDocument();
  });

  it('even when counterfactuals are also present on the row', () => {
    panel({ verdict: 'WATCH', funnel, counterfactuals: COUNTERFACTUALS });
    expect(screen.queryByText('What we ruled out')).not.toBeInTheDocument();
  });
});

describe('nothing to rule out', () => {
  // Every row written before the engine published these, plus every KILL the
  // engine reached with a single candidate — with nothing to compare against
  // there was no alternative to set aside. An empty list is a real answer.
  it.each([[null], [undefined], [[]]])('renders no block for %s, and keeps the prose', (counterfactuals) => {
    panel({ counterfactuals });
    expect(screen.queryByText('What we ruled out')).not.toBeInTheDocument();
    expect(screen.getByText(/Lowest CTR in the conversion group/)).toBeInTheDocument();
  });

  it('a malformed payload does not take the panel down', () => {
    expect(() => panel({ counterfactuals: [null, {}] })).not.toThrow();
    expect(screen.getByText(/Lowest CTR in the conversion group/)).toBeInTheDocument();
  });
});

// ── The primary mechanism, and the gate on it ────────────────
const HYPOTHESES = [{
  id: 'CREATIVE_FATIGUE',
  labelKey: 'diagnosis.creativeFatigue',
  source: 'absolute',
  observed: [{ metric: 'FREQUENCY', value: 4.2, benchmark: 3.5, severity: 'CRITICAL' }],
  supports: ['FREQUENCY'],
  contradicts: [],
  confidence: { reasoning: 0.8, data: 0.6 },
}, {
  id: 'AUDIENCE_MISMATCH', labelKey: 'diagnosis.audienceMismatch', source: 'absolute',
  observed: [], supports: [], contradicts: [], confidence: { reasoning: 0.4, data: 0.6 },
}];

describe('why we believe this', () => {
  it('names the mechanism the verdict rests on', () => {
    panel({ hypotheses: HYPOTHESES });
    expect(screen.getByText('Why we believe this')).toBeInTheDocument();
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
    expect(screen.getByText(/Frequency is above the ceiling/)).toBeInTheDocument();
  });

  it('groups both halves under one Reasoning heading', () => {
    panel({ hypotheses: HYPOTHESES });
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Why we believe this')).toBeInTheDocument();
    expect(screen.getByText('What we ruled out')).toBeInTheDocument();
  });

  it('reads why → ruled out → next step', () => {
    const { container } = panel({ hypotheses: HYPOTHESES });
    const t = container.textContent;
    expect(t.indexOf('Why we believe this')).toBeLessThan(t.indexOf('What we ruled out'));
    expect(t.indexOf('What we ruled out')).toBeLessThan(t.indexOf('Next step:'));
  });

  // hypotheses[1..n] ARE the counterfactuals. Rendering the array would print
  // Audience mismatch as a live candidate AND as ruled out, in adjacent blocks.
  it('shows only the primary — the rest are already the counterfactuals', () => {
    panel({ hypotheses: HYPOTHESES });
    expect(screen.getAllByText('Audience mismatch')).toHaveLength(1);
  });
});

describe('the honesty gate, end to end', () => {
  // The failure it prevents: a bottom-of-cohort HOLD upgraded to KILL by the
  // relative pass. The absolute hypotheses still describe the campaign and did
  // NOT decide the verdict — showing them would send a marketer to rewrite a
  // creative the engine never blamed.
  it.each([['TOP'], ['BOTTOM']])('hides the mechanism when the cohort pass (%s) decided it', (rank) => {
    panel({ hypotheses: HYPOTHESES, relativeRank: rank });
    expect(screen.queryByText('Why we believe this')).not.toBeInTheDocument();
    expect(screen.queryByText('Creative fatigue')).not.toBeInTheDocument();
  });

  // Suppressing the mechanism must not suppress the rejections: what was ruled
  // out stays true regardless of which pass reached the verdict.
  it('keeps the counterfactuals, and the Reasoning section, either way', () => {
    panel({ hypotheses: HYPOTHESES, relativeRank: 'BOTTOM' });
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('What we ruled out')).toBeInTheDocument();
  });

  it('and the prose rationale still explains the call', () => {
    panel({ hypotheses: HYPOTHESES, relativeRank: 'BOTTOM' });
    expect(screen.getByText(/Lowest CTR in the conversion group/)).toBeInTheDocument();
  });
});

// ── Which half of confidence is holding the number down ──────
// The panel has always shown a bare band. "Low" reads as "the engine is unsure
// about your campaign"; usually it is unsure about its own evidence, and the two
// halves have opposite implications — thin data is something an operator fixes
// by waiting, a weak signal is not.
describe('the limiting factor, on a funnel row', () => {
  const watch = (over = {}) => panel({ verdict: 'WATCH', funnel, rootCause: 'FUNNEL_DROP_POST_CLICK', ...over });

  it('says nothing extra when both halves are healthy', () => {
    watch({ confidence: 0.85, dataConfidence: 0.9, signalConfidence: 0.9 });
    expect(screen.getByText(/High confidence/)).toBeInTheDocument();
    expect(screen.queryByText(/limited/)).not.toBeInTheDocument();
  });

  it('blames thin data when that is what is holding it down', () => {
    watch({ confidence: 0.45, dataConfidence: 0.3, signalConfidence: 0.9 });
    expect(screen.getByText(/Low confidence · limited by available data/)).toBeInTheDocument();
  });

  it('blames the signal when the data behind it was fine', () => {
    watch({ confidence: 0.45, dataConfidence: 0.9, signalConfidence: 0.4 });
    expect(screen.getByText(/Low confidence · limited supporting signal quality/)).toBeInTheDocument();
  });

  it('names one factor, not both, when both are thin', () => {
    watch({ confidence: 0.2, dataConfidence: 0.3, signalConfidence: 0.3 });
    expect(screen.getByText(/limited by available data/)).toBeInTheDocument();
    expect(screen.queryByText(/limited supporting signal quality/)).not.toBeInTheDocument();
  });

  // Every row rendered before this field was threaded through the three hops
  // between the engine and here.
  it('a row with no signal half reads exactly as it did before', () => {
    watch({ confidence: 0.45, dataConfidence: 0.3, signalConfidence: null });
    expect(screen.getByText(/Low confidence · limited by available data/)).toBeInTheDocument();
    expect(screen.queryByText(/signal quality/)).not.toBeInTheDocument();
  });
});

// The KILL/SCALE half of the same question. The funnel line above and this one
// are disjoint by construction — funnel rows get no hypothesis block, non-funnel
// rows get no funnel line — so a row is told which half is weak exactly once.
describe('signal quality, on a mechanism row', () => {
  it('bands the primary hypothesis reasoning inside the block', () => {
    panel({ hypotheses: HYPOTHESES });
    expect(screen.getByText('Signal quality: High')).toBeInTheDocument();
  });

  it('reads the hypothesis, not the verdict-level signalConfidence', () => {
    // A relative upgrade re-stamps signalConfidence and leaves the hypothesis
    // untouched. Sourcing the block from the verdict field would print the
    // ranking's strength under a mechanism it says nothing about.
    panel({ hypotheses: HYPOTHESES, signalConfidence: 0.1 });
    expect(screen.getByText('Signal quality: High')).toBeInTheDocument();
  });

  it('shows no second confidence line beside it', () => {
    panel({ hypotheses: HYPOTHESES, confidence: 0.4, dataConfidence: 0.2 });
    expect(screen.queryByText(/limited by available data/)).not.toBeInTheDocument();
  });

  it('goes with the block when the honesty gate fires', () => {
    panel({ hypotheses: HYPOTHESES, relativeRank: 'BOTTOM' });
    expect(screen.queryByText(/Signal quality/)).not.toBeInTheDocument();
  });
});

// ── The cohort verdict, finally explaining itself ────────────
// A relative KILL is decided by cohort rank, so its hypotheses belong to the
// absolute pass and the honesty gate hides them — taking the counterfactuals
// with them. That left the loudest verdict in the product explained by one
// sentence, with the cohort figures existing only inside that sentence.
const COHORT = { rank: 'BOTTOM', group: 'conversion', cohortSize: 8, ctrPct: 0.7, avgCtrPct: 1.5 };

describe('a cohort KILL says what cohort', () => {
  it('renders the block, inside Reasoning', () => {
    panel({ relativeRank: 'BOTTOM', relativeContext: COHORT, hypotheses: HYPOTHESES });
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Cohort ranking')).toBeInTheDocument();
    expect(screen.getByText(/Ranked against 8 campaigns/)).toBeInTheDocument();
  });

  // Mutually exclusive BY CONSTRUCTION: relativeContext exists only where
  // relativeRank does, which is exactly where the honesty gate returns null. The
  // two can never argue over one verdict.
  it('never shares a panel with the mechanism block', () => {
    panel({ relativeRank: 'BOTTOM', relativeContext: COHORT, hypotheses: HYPOTHESES });
    expect(screen.queryByText('Why we believe this')).not.toBeInTheDocument();
  });

  it('an absolutely-decided verdict gets no cohort block', () => {
    panel({ hypotheses: HYPOTHESES });
    expect(screen.queryByText('Cohort ranking')).not.toBeInTheDocument();
    expect(screen.getByText('Why we believe this')).toBeInTheDocument();
  });

  // NOT gated on funnel, unlike the two blocks beside it. A relative upgrade
  // requires revenueMeasured === false, and `funnel` is attached whenever a
  // stage was diagnosable — so the two co-occur, and on those rows this is the
  // only thing on screen naming what actually decided the verdict.
  it('still explains a cohort KILL that also carries funnel data', () => {
    panel({ verdict: 'KILL', funnel, relativeRank: 'BOTTOM', relativeContext: COHORT });
    expect(screen.getByText('Cohort ranking')).toBeInTheDocument();
  });

  // The guard tracks what is RENDERED, which is the cohort size. A payload
  // missing it would print "Ranked against  campaigns".
  it.each([[null], [undefined], [{}], [{ rank: 'BOTTOM', ctrPct: 0.7 }]])(
    'renders no card for %s rather than one with blanks in it', (relativeContext) => {
      panel({ relativeRank: 'BOTTOM', relativeContext });
      expect(screen.queryByText('Cohort ranking')).not.toBeInTheDocument();
    },
  );

  // And it does NOT insist on the figures this block stopped printing — they
  // ride along for other surfaces, so demanding them here would suppress a
  // perfectly renderable card over two fields nobody reads.
  it('renders on cohort size alone, without the figures it no longer shows', () => {
    panel({ relativeRank: 'BOTTOM', relativeContext: { rank: 'BOTTOM', group: 'conversion', cohortSize: 8 } });
    expect(screen.getByText(/Ranked against 8 campaigns/)).toBeInTheDocument();
  });
});

describe('the confidence line steps aside for it', () => {
  // WHY: a relative upgrade stamps signalConfidence at exactly RR.CONFIDENCE
  // (0.6), which composes against healthy data to a product below the Medium
  // band while NEITHER half is itself below it. So the line reads "Low
  // confidence" and names no reason — because by its own test there isn't one —
  // directly beneath a block that explains the verdict completely.
  it('is hidden on a cohort row', () => {
    panel({
      verdict: 'KILL', funnel, relativeRank: 'BOTTOM', relativeContext: COHORT,
      confidence: 0.48, dataConfidence: 0.8, signalConfidence: 0.6,
    });
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.getByText('Cohort ranking')).toBeInTheDocument();
  });

  it('is untouched on every other row', () => {
    panel({ verdict: 'WATCH', funnel, confidence: 0.45, dataConfidence: 0.3, signalConfidence: 0.9 });
    expect(screen.getByText(/Low confidence · limited by available data/)).toBeInTheDocument();
  });
});

describe('no reasoning to show', () => {
  it('renders no Reasoning section at all when neither half has anything', () => {
    panel({ hypotheses: null, counterfactuals: null });
    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
  });

  it('a WATCH keeps its funnel prose and gets no Reasoning section', () => {
    panel({ verdict: 'WATCH', funnel, hypotheses: HYPOTHESES });
    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
    expect(screen.getByText(/Not a creative problem/)).toBeInTheDocument();
  });
});
