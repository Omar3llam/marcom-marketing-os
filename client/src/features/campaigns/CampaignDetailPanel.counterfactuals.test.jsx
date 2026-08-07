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
