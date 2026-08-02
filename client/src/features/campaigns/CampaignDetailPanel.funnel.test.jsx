// ============================================================
// CampaignDetailPanel — structured funnel provenance (PR #309)
// ------------------------------------------------------------
// The panel now READS the engine's funnel object instead of parsing its prose.
// The regression these pin: a funnel diagnosis is always a WATCH, and the "Why?"
// block only rendered for KILL/SCALE — so the whole funnel layer was invisible.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CampaignDetailPanel } from './CampaignDetailPanel.jsx';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

const campaign = (over = {}) => ({
  entityId: 'f1', name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 50000, ctr: 0.025, frequency: 1.4, roas: 1.6, currency: 'EGP', ...over,
});

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

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { reasoning: null, stale: false, generatedAt: null } });
});

describe('a funnel WATCH is visible at all', () => {
  it('renders the block for a WATCH carrying a funnel', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} rootCause="FUNNEL_DROP_POST_CLICK" />);
    expect(screen.getByText('Where the money is going')).toBeInTheDocument();
    expect(screen.getByText('Traffic is not reaching the landing page')).toBeInTheDocument();
  });

  it('names the stage', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} />);
    expect(screen.getByText('LPV')).toBeInTheDocument();
  });
});

describe('evidence is rendered as a comparison, not restated as a claim', () => {
  it('shows each metric with its value AND the benchmark it was judged against', () => {
    // Scoped to the "Why?" block: "CTR" also labels a row in the Signals list,
    // and an unscoped query would match either — passing for the wrong reason.
    const { container } = render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} />);
    const block = within(container.querySelector('dl'));
    expect(block.getByText('CTR')).toBeInTheDocument();
    expect(block.getByText('2.50%')).toBeInTheDocument();
    expect(block.getByText('vs 0.80%')).toBeInTheDocument();
    expect(block.getByText('Landing page views / clicks')).toBeInTheDocument();
    expect(block.getByText('40.0%')).toBeInTheDocument();
    expect(block.getByText('vs 60.0%')).toBeInTheDocument();
  });

  it('the evidence table is the ONLY place these numbers come from', () => {
    // Guards against the panel quietly recomputing a rate: the CTR shown in the
    // evidence row is the engine's 2.5, not the campaign's own 0.025 fraction
    // formatted a second way.
    const { container } = render(<CampaignDetailPanel campaign={campaign({ ctr: 0.0999 })} verdict="WATCH" funnel={funnel} />);
    expect(within(container.querySelector('dl')).getByText('2.50%')).toBeInTheDocument();
  });

  it('renders the counterfactual — the line that stops the wrong fix', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} />);
    expect(screen.getByText(/not a creative problem/i)).toBeInTheDocument();
  });

  it('renders the action as the next step', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} />);
    expect(screen.getByText(/check pixel installation/i)).toBeInTheDocument();
  });

  it('does NOT fall back to parsing the rationale when a funnel is present', () => {
    // The prose clause would duplicate the diagnosis under a different wording.
    const rationale = 'Traffic is not reaching the landing page (LPV) — Not a creative problem: CTR 2.50% is above. Check pixel.';
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} rationale={rationale} />);
    expect(screen.queryByText('Traffic is not reaching the landing page (LPV)')).not.toBeInTheDocument();
    expect(screen.getByText('Traffic is not reaching the landing page')).toBeInTheDocument();
  });
});

describe('a not-judged-yet state does not read as a broken campaign', () => {
  const thin = { verdict: 'WATCH', rootCause: 'INSUFFICIENT_DATA' };

  it('uses its own heading', () => {
    render(<CampaignDetailPanel campaign={campaign()} {...thin} rationale="Insufficient data: 120 of 1,000 impressions needed — too thin to judge yet." />);
    expect(screen.getByText('Not judged yet')).toBeInTheDocument();
  });

  it('keeps the counts that say how far off the campaign is', () => {
    render(<CampaignDetailPanel campaign={campaign()} {...thin} rationale="Insufficient data: 120 of 1,000 impressions needed — too thin to judge yet." />);
    expect(screen.getByText(/120 of 1,000 impressions needed/)).toBeInTheDocument();
  });

  it('offers no next step — there is no platform action for "wait"', () => {
    render(<CampaignDetailPanel campaign={campaign()} {...thin} rationale="Insufficient data: 120 of 1,000 impressions needed — too thin to judge yet." />);
    expect(screen.queryByText(/next step/i)).not.toBeInTheDocument();
  });

  it('offers no shareable recommendation for a verdict it did not reach', () => {
    render(<CampaignDetailPanel campaign={campaign({ roas: null })} {...thin} rationale="Insufficient data: 120 of 1,000 impressions needed — too thin to judge yet." />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    // …and no no-revenue disclaimer either: not having judged is not the same
    // as having judged without revenue.
    expect(screen.queryByText(/No revenue data found/i)).not.toBeInTheDocument();
  });
});

describe('confidence explains itself', () => {
  it('says when thin inputs are what is limiting it', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} confidence={0.35} dataConfidence={0.42} />);
    expect(screen.getByText(/limited by available data/i)).toBeInTheDocument();
  });

  it('does not blame the data when the data is fine', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="WATCH" funnel={funnel} confidence={0.8} dataConfidence={0.93} />);
    expect(screen.queryByText(/limited by available data/i)).not.toBeInTheDocument();
    expect(screen.getByText(/High confidence/)).toBeInTheDocument();
  });
});

describe('verdicts with no funnel are unchanged', () => {
  it('a KILL still renders its prose clause and next step', () => {
    render(
      <CampaignDetailPanel
        campaign={campaign()} verdict="KILL" confidence={0.9}
        rationale="ROAS 0.60 below break-even with frequency 4.2 past the 3.5 ceiling."
      />,
    );
    expect(screen.getByText('Why kill?')).toBeInTheDocument();
    expect(screen.getByText(/ROAS 0.60 below break-even/)).toBeInTheDocument();
    expect(screen.getByText(/next step/i)).toBeInTheDocument();
  });

  it('a plain HOLD still shows no block', () => {
    render(<CampaignDetailPanel campaign={campaign()} verdict="HOLD" rationale="Within healthy parameters." />);
    expect(screen.queryByText('Why hold?')).not.toBeInTheDocument();
    expect(screen.queryByText('Where the money is going')).not.toBeInTheDocument();
  });
});
