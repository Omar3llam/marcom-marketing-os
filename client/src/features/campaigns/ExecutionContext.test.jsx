// ============================================================
// ExecutionContext — "where to execute", and the wording it commits to
// ------------------------------------------------------------
// Presentational, so the tests split in three: it renders only when the SERVER
// handed it a pick, it says INSPECT rather than PAUSE, and it lets the operator
// record what they did. The wording assertions are not style policing — a low
// CTR has causes no MetricSnapshot can see (a learning phase, a deliberate broad
// test), so an imperative "Pause this" would be a claim the data cannot back.
//
// The pick now arrives as `evidence` (analyzeEvidence's result, via useEvidence)
// rather than being re-derived here from ad-set rows. That is the point of the
// change: this component and its two callers used to run two different rankers
// over the same campaign, agreeing only because they happened to share a
// threshold. The refusal cases that used to live here — one ad set, ordinary
// variance, nothing loaded — are the SERVER's to make now, and it reports each
// one with a distinguishable reasonKey the callers render instead.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutionContext } from './ExecutionContext.jsx';

const campaign = { entityId: 'c-1', name: 'Q3 Prospecting', ctr: 0.0164, spendMinor: 655_300, currency: 'USD' };

const worst = {
  entityId: 'as-2', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0032, spendMinor: 325_500, currency: 'USD',
};
const best = {
  entityId: 'as-1', name: 'Lookalike 1%', channel: 'META',
  ctr: 0.0180, spendMinor: 200_00, currency: 'USD',
};

/**
 * What the server returns. The component reads `summary.bottom` for the pick and
 * `ranked.length` for how strong the comparison was — nothing else.
 */
const evidenceFor = (bottom = worst, rankedCount = 3) => ({
  dimension: 'ADSET',
  metric: 'ctr',
  ranked: Array.from({ length: rankedCount }, (_, i) => (i === 0 ? bottom : { ...best, entityId: `as-${i}` })),
  summary: { bottom, top: best, outliers: [bottom] },
  dataConfidence: 0.8,
});

const setup = (over = {}) => render(
  <ExecutionContext campaign={campaign} evidence={evidenceFor()} verdict="KILL" {...over} />,
);

describe('ExecutionContext — when it renders nothing', () => {
  it.each([['HOLD'], ['SCALE'], ['WATCH'], ['REFRESH'], [null], [undefined]])(
    'a %s verdict has nothing to execute on', (verdict) => {
      const { container } = setup({ verdict });
      expect(container).toBeEmptyDOMElement();
    });

  it('no campaign row at all', () => {
    const { container } = setup({ campaign: null });
    expect(container).toBeEmptyDOMElement();
  });

  // Both callers gate the mount on a real ranking, so these should be
  // unreachable. Asserted anyway: a component that throws on a missing prop
  // takes the whole card down with it, and the prop comes off a network read.
  it.each([
    ['no evidence yet', { evidence: null }],
    ['evidence without a summary', { evidence: { ranked: [] } }],
    ['a summary without a bottom row', { evidence: { summary: {}, ranked: [] } }],
  ])('renders nothing given %s', (_label, over) => {
    const { container } = setup(over);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ExecutionContext — the pick', () => {
  it('renders under an actionable verdict with a real ranking', () => {
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
    expect(screen.getByText('Execute here')).toBeInTheDocument();
    expect(screen.queryByText('Start here')).not.toBeInTheDocument();
    expect(screen.queryByText('Focus here first')).not.toBeInTheDocument();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/problem|culprit|blame/i)).not.toBeInTheDocument();
  });

  it('names the server-ranked bottom ad set and its channel', () => {
    setup();
    expect(screen.getAllByText('Broad 25-45').length).toBeGreaterThan(0);
    expect(screen.getByText('AD SET · META')).toBeInTheDocument();
  });

  // The whole reason the local ranker went. If this component re-derived the
  // pick it could disagree with the server that decided there was one at all.
  it('names whatever the server put in summary.bottom, not the lowest CTR it can see', () => {
    setup({ evidence: { ...evidenceFor(), summary: { bottom: best, top: worst, outliers: [best] } } });
    expect(screen.getAllByText('Lookalike 1%').length).toBeGreaterThan(0);
    expect(screen.queryByText('Broad 25-45')).not.toBeInTheDocument();
  });
});

describe('ExecutionContext — the evidence', () => {
  it('lists why this one was selected', () => {
    setup();
    expect(screen.getByText('Selected because')).toBeInTheDocument();
    expect(screen.getByText(/Lowest CTR in campaign \(-80%/)).toBeInTheDocument();
  });

  // Quoted from the SERVER's ranked cohort. Picked from 3 is a weaker claim than
  // picked from 30, and the count must describe the comparison that actually ran.
  it('quotes how many ad sets the server compared', () => {
    setup({ evidence: evidenceFor(worst, 5) });
    expect(screen.getByText('Compared against 5 ad sets reporting CTR')).toBeInTheDocument();
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
    setup({ evidence: evidenceFor({ ...worst, spendMinor: null }) });
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
    setup({ evidence: evidenceFor({ ...worst, currency: 'GBP' }) });
    expect(screen.getByText('£3,255.00')).toBeInTheDocument();
    expect(screen.queryByText('$3,255.00')).not.toBeInTheDocument();
  });

  it('withholds an ad set spend without currency while keeping the CTR evidence', () => {
    setup({ evidence: evidenceFor({ ...worst, currency: null }) });
    expect(screen.getByText('Where to execute')).toBeInTheDocument();
    expect(screen.getByText('0.32%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$3,255.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/% of campaign spend/)).not.toBeInTheDocument();
  });

  it('withholds a spend share across different currencies', () => {
    setup({ evidence: evidenceFor({ ...worst, currency: 'GBP' }) });
    expect(screen.getByText('£3,255.00')).toBeInTheDocument();
    expect(screen.queryByText(/% of campaign spend/)).not.toBeInTheDocument();
  });
});

// The base fixture carries no impressions, so buildHypothesis short-circuits at
// H0 — these tests opt in by giving the bottom row real delivery.
//
// Labelled "Ad set signal" on screen, not "Working hypothesis": the engine
// renders its OWN hypotheses on the campaign detail panel one click away, and
// the two share no field and answer different questions — this reads a single
// ad-set row, that names the mechanism a verdict rests on.
describe('ExecutionContext — the ad set signal', () => {
  const withDelivery = (over) => evidenceFor({ ...worst, impressions: 500_000, ...over });

  it('is absent when the data cannot support one', () => {
    setup(); // no impressions on the ranked row
    expect(screen.queryByText('Ad set signal')).not.toBeInTheDocument();
  });

  it('separates what was observed from what it might mean', () => {
    setup({ evidence: withDelivery({ frequency: 4.2 }) });
    expect(screen.getByText('Ad set signal')).toBeInTheDocument();
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText('Interpretation')).toBeInTheDocument();
  });

  it('names creative fatigue when frequency is past the ceiling and CTR is low', () => {
    setup({ evidence: withDelivery({ frequency: 4.2 }) });
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
    expect(screen.getByText(/Frequency is 4\.2, above Lumi's fatigue threshold \(3\.5\)/)).toBeInTheDocument();
    expect(screen.getByText('Refresh the creative before pausing the ad set.')).toBeInTheDocument();
  });

  it('falls back to audience or creative when there is no fatigue signal', () => {
    setup({ evidence: withDelivery({ frequency: 1.8 }) });
    expect(screen.getByText('No fatigue signal detected')).toBeInTheDocument();
    expect(screen.getByText(/more commonly associated with audience fit/)).toBeInTheDocument();
    expect(screen.getByText('Review the creative and audience targeting before pausing.')).toBeInTheDocument();
  });

  it('says the delivery is too thin rather than diagnosing it', () => {
    setup({ evidence: withDelivery({ frequency: 4.2, spendMinor: 4_999 }) });
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

// ============================================================
// The answer — the only path by which a verdict becomes a scored prediction
// ============================================================
describe('ExecutionContext — recording what the operator did', () => {
  let onExecute, onDismiss;
  beforeEach(() => { onExecute = vi.fn(); onDismiss = vi.fn(); });

  const withActions = (over = {}) => setup({ onExecute, onDismiss, ...over });

  it('offers both answers before either is given', () => {
    withActions();
    expect(screen.getByRole('button', { name: 'I executed this' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not applicable' })).toBeInTheDocument();
  });

  // Without this the pair reads as a satisfaction survey, and "Not applicable"
  // looks like a way to hide the row rather than a recorded judgement.
  it('says what the answer is for', () => {
    withActions();
    expect(screen.getByText(/it is how Lumi learns whether its calls were right/i)).toBeInTheDocument();
  });

  it.each([
    ['I executed this', () => onExecute],
    ['Not applicable',  () => onDismiss],
  ])('%s calls its handler', async (label, handler) => {
    withActions();
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(handler()).toHaveBeenCalledTimes(1);
  });

  // A surface with no way to record an answer must not ask for one.
  it('shows no buttons when the caller passes no handlers', () => {
    setup();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([['executing'], ['dismissing']])('%s shows progress and withdraws the buttons', (executionState) => {
    withActions({ executionState });
    expect(screen.getByText('Recording…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // ONE-WAY. A terminal state replaces the buttons rather than disabling them:
  // a control that still looks clickable invites a second click, and a second
  // click on a recorded claim is not a second claim.
  it.each([
    ['executed',  'Recorded as executed'],
    ['dismissed', 'Recorded as not applicable'],
  ])('%s is terminal and acknowledged', (executionState, text) => {
    withActions({ executionState });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The verdict was replaced between render and click. Not a failure, and not
  // retryable — "try again" would aim them at a request that 404s forever.
  it('a stale verdict says so, and does not offer a retry', () => {
    withActions({ executionState: 'stale' });
    expect(screen.getByText(/This verdict was replaced/)).toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a real failure is the only state that mentions trying again', () => {
    withActions({ executionState: 'error' });
    expect(screen.getByText(/Couldn't record/)).toBeInTheDocument();
    expect(screen.getByText(/try again/i)).toBeInTheDocument();
  });

  // The pick and its evidence stay put. An operator who recorded an execution
  // still needs the ad set name in front of them to go and do it.
  it('keeps the evidence on screen after the answer is recorded', () => {
    withActions({ executionState: 'executed' });
    expect(screen.getByText('Where to execute')).toBeInTheDocument();
    expect(screen.getAllByText('Broad 25-45').length).toBeGreaterThan(0);
  });
});
