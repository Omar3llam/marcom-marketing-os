// ============================================================
// ExecutionContext — "where to execute", and the wording it commits to
// ------------------------------------------------------------
// Presentational, so the tests split in two: it renders only when the data
// earns a pick, and it says INSPECT rather than PAUSE. The wording assertions
// are not style policing — a low CTR has causes no MetricSnapshot can see (a
// learning phase, a deliberate broad test), so an imperative "Pause this" would
// be a claim the data cannot back.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionContext } from './ExecutionContext.jsx';

const campaign = { entityId: 'c-1', name: 'Q3 Prospecting', ctr: 0.0164, spendMinor: 655_300, currency: 'USD' };

const adSets = [
  { entityId: 'as-1', name: 'Lookalike 1%', channel: 'META', ctr: 0.0180, spendMinor: 200_00, currency: 'USD' },
  { entityId: 'as-2', name: 'Broad 25-45', channel: 'META', ctr: 0.0032, spendMinor: 325_500, currency: 'USD' },
  { entityId: 'as-3', name: 'Retarget 30d', channel: 'META', ctr: 0.0150, spendMinor: 100_00, currency: 'USD' },
];

const setup = (over = {}) => render(
  <ExecutionContext campaign={campaign} adSets={adSets} verdict="KILL" {...over} />,
);

describe('ExecutionContext — when it renders nothing', () => {
  it.each([['HOLD'], ['SCALE'], ['WATCH'], ['REFRESH'], [null], [undefined]])(
    'a %s verdict has nothing to execute on', (verdict) => {
      const { container } = setup({ verdict });
      expect(container).toBeEmptyDOMElement();
    });

  it('one ad set is not a comparison', () => {
    const { container } = setup({ adSets: [adSets[1]] });
    expect(container).toBeEmptyDOMElement();
  });

  it('ad sets within ordinary variance of the campaign rate', () => {
    const { container } = setup({ adSets: [
      { ...adSets[0], ctr: 0.0160 }, { ...adSets[1], ctr: 0.0150 },
    ] });
    expect(container).toBeEmptyDOMElement();
  });

  it('no campaign CTR to measure against', () => {
    const { container } = setup({ campaign: { ...campaign, ctr: null } });
    expect(container).toBeEmptyDOMElement();
  });

  it('ad sets that have not loaded yet', () => {
    const { container } = setup({ adSets: [] });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ExecutionContext — the pick', () => {
  it('renders under an actionable verdict with a real gap', () => {
    setup();
    expect(screen.getByText('Where to execute')).toBeInTheDocument();
  });

  it.each([['KILL'], ['REALLOCATE']])('%s is actionable', (verdict) => {
    setup({ verdict });
    expect(screen.getByText('Where to execute')).toBeInTheDocument();
  });

  // "Focus here first" is a place to start looking. "Root cause" would claim
  // this ad set explains the campaign's verdict — an inference from two ratios.
  it('frames the pick as where to look, not what is wrong', () => {
    setup();
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.queryByText('Focus here first')).not.toBeInTheDocument();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/problem|culprit|blame/i)).not.toBeInTheDocument();
  });

  it('names the lowest-CTR ad set and its channel', () => {
    setup();
    expect(screen.getAllByText('Broad 25-45').length).toBeGreaterThan(0);
    expect(screen.getByText('AD SET · META')).toBeInTheDocument();
  });

  it('does not name a better-performing ad set', () => {
    setup();
    expect(screen.queryByText('Lookalike 1%')).not.toBeInTheDocument();
  });
});

describe('ExecutionContext — the evidence', () => {
  it('lists why this one was selected', () => {
    setup();
    expect(screen.getByText('Selected because')).toBeInTheDocument();
    expect(screen.getByText(/Lowest CTR in campaign \(-80%/)).toBeInTheDocument();
    expect(screen.getByText('Compared against 3 ad sets reporting CTR')).toBeInTheDocument();
  });

  it('shows the ad set CTR and its gap against the campaign rate', () => {
    setup();
    expect(screen.getByText('0.32%')).toBeInTheDocument();
    expect(screen.getByText('-80%')).toBeInTheDocument();
  });

  it('shows the spend and its share of the campaign', () => {
    setup();
    expect(screen.getByText('50% of campaign')).toBeInTheDocument();
    expect(screen.getByText('$3,255.00')).toBeInTheDocument();
  });

  // A snapshot may carry a CTR and no spend. The pick still stands; the money
  // line drops rather than reading $0.00 or 0%.
  it('an unreported spend is an em dash, and its share line disappears', () => {
    setup({ adSets: adSets.map((a) => (a.entityId === 'as-2' ? { ...a, spendMinor: null } : a)) });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/of campaign$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('a campaign with no spend figure drops the share, keeps the pick', () => {
    setup({ campaign: { ...campaign, spendMinor: null } });
    expect(screen.getByText('Where to execute')).toBeInTheDocument();
    expect(screen.queryByText(/% of campaign spend/)).not.toBeInTheDocument();
  });

  // The row carries its own currency (the connector reads it per account), so
  // the spend must never be formatted as dollars by default.
  it('renders the ad set currency, not a USD default', () => {
    setup({ adSets: adSets.map((a) => ({ ...a, currency: 'GBP' })) });
    expect(screen.getByText('£3,255.00')).toBeInTheDocument();
    expect(screen.queryByText('$3,255.00')).not.toBeInTheDocument();
  });
});

// The base fixture carries no impressions, so buildHypothesis short-circuits at
// H0 — these tests opt in by giving the worst ad set real delivery.
describe('ExecutionContext — the working hypothesis', () => {
  const withDelivery = (over) => adSets.map((a) => (
    a.entityId === 'as-2' ? { ...a, impressions: 500_000, ...over } : a
  ));

  it('is absent when the data cannot support one', () => {
    setup(); // no impressions on any row
    expect(screen.queryByText('Working hypothesis')).not.toBeInTheDocument();
  });

  it('separates what was observed from what it might mean', () => {
    setup({ adSets: withDelivery({ frequency: 4.2 }) });
    expect(screen.getByText('Working hypothesis')).toBeInTheDocument();
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText('Interpretation')).toBeInTheDocument();
  });

  it('names creative fatigue when frequency is past the ceiling and CTR is low', () => {
    setup({ adSets: withDelivery({ frequency: 4.2 }) });
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
    expect(screen.getByText(/Frequency is 4\.2, above Lumi's fatigue threshold \(3\.5\)/)).toBeInTheDocument();
    expect(screen.getByText('Refresh the creative before pausing the ad set.')).toBeInTheDocument();
  });

  it('falls back to audience or creative when there is no fatigue signal', () => {
    setup({ adSets: withDelivery({ frequency: 1.8 }) });
    expect(screen.getByText('No fatigue signal detected')).toBeInTheDocument();
    expect(screen.getByText(/more commonly associated with audience fit/)).toBeInTheDocument();
    expect(screen.getByText('Review the creative and audience targeting before pausing.')).toBeInTheDocument();
  });

  it('says the delivery is too thin rather than diagnosing it', () => {
    setup({ adSets: withDelivery({ frequency: 4.2, spendMinor: 4_999 }) });
    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
    expect(screen.queryByText('Creative fatigue')).not.toBeInTheDocument();
    expect(screen.getByText('Wait for more delivery before acting.')).toBeInTheDocument();
  });
});

describe('ExecutionContext — the ask', () => {
  it('asks the marketer to inspect, never to pause outright', () => {
    setup();
    expect(screen.getByText(/Inspect/)).toBeInTheDocument();
    expect(screen.queryByText(/^Pause /)).not.toBeInTheDocument();
    expect(screen.queryByText(/pause it now|pause immediately/i)).not.toBeInTheDocument();
  });

  // Pausing is offered as something the marketer decides once they have looked
  // — the data cannot see a learning phase or a deliberate test.
  it('offers pausing as a conditional the marketer resolves', () => {
    setup();
    expect(screen.getByText(/If no test or learning phase explains the gap, consider pausing it\./))
      .toBeInTheDocument();
  });

  it('quotes the gap magnitude in the action sentence', () => {
    setup();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText(/below the campaign rate/)).toBeInTheDocument();
  });
});
