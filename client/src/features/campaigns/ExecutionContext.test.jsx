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

const envelope = (over = {}) => ({ status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0, ...over });

const campaign = { entityId: 'c-1', name: 'Q3 Prospecting', ctr: 0.0164, spendMinor: 655_300, currency: 'USD' };

const worst = {
  entityId: 'as-2', name: 'Broad 25-45', channel: 'META',
  ctr: 0.0032, spendMinor: 325_500, currency: 'USD', _gap: -0.80,
};
const best = {
  entityId: 'as-1', name: 'Lookalike 1%', channel: 'META',
  ctr: 0.0180, spendMinor: 200_00, currency: 'USD', _gap: 0.10,
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
  <ExecutionContext campaign={campaign} parent={campaign} evidence={evidenceFor()} comparisonEnvelope={envelope({ rankableCount: 3, comparableCount: 3 })} verdict="KILL" {...over} />,
);

describe('P7-04B comparison authority', () => {
  it('withholds an unadmitted comparison when its envelope is absent', () => {
    expect(setup({ comparisonEnvelope: null }).container).toBeEmptyDOMElement();
  });
  it('preserves exact non-midnight server bounds without substituting a sync clock', () => {
    setup({ comparisonEnvelope: envelope({ windowStart: '2026-08-01T21:00:00.000Z', windowEnd: '2026-08-30T21:00:00.000Z' }) });
    expect(screen.getByText(/2026-08-01T21:00:00.000Z.*2026-08-30T21:00:00.000Z/)).toBeInTheDocument();
  });
  it('P7-07A shows the exact server period, source and comparable population', () => {
    setup({ comparisonEnvelope: { status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
      gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
      windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
      currency: null, currencyProvenance: null, rankableCount: 4, comparableCount: 3, excludedByEnvelopeCount: 1 } });
    expect(screen.getByText(/2026-08-01.*2026-08-30.*META/)).toBeInTheDocument();
    expect(screen.getByText(/3 reporting ad sets with comparable evidence.*1 excluded/)).toBeInTheDocument();
  });
  it.each(['thumbstop', 'constructor'])('withholds an unknown metric %s', (metric) => {
    const { container } = setup({ evidence: { ...evidenceFor(), metric } });
    expect(container).toBeEmptyDOMElement();
  });
  it('formats the server gap even when raw values imply another comparison', () => {
    setup({ parent: { ctr: 0.02 }, evidence: evidenceFor({ ...worst, ctr: 0.0066, _gap: -0.34 }) });
    expect(screen.getByText('-34%')).toBeInTheDocument();
    expect(screen.getByText('34% below campaign')).toBeInTheDocument();
    expect(screen.queryByText('-60%')).not.toBeInTheDocument();
  });
  it('shows the same-response parent rather than the campaign row baseline', () => {
    setup({ campaign: { ...campaign, ctr: 0.01 }, parent: { ctr: 0.02 },
      evidence: evidenceFor({ ...worst, ctr: 0.012, _gap: -0.40 }) });
    expect(screen.getByText('2.00%')).toBeInTheDocument();
    expect(screen.getByText('-40%')).toBeInTheDocument();
    expect(screen.queryByText('1.00%')).not.toBeInTheDocument();
  });
  it('does not publish a locally calculated spend share', () => {
    setup();
    expect(screen.queryAllByText(/% of campaign/)).toHaveLength(0);
  });
  it.each([
    { frequency: 4.2, impressions: 500000 },
    { frequency: 1.8, impressions: 500000 },
    { frequency: 4.2, impressions: 500000, spendMinor: 4999 },
  ])('does not create diagnostic classifications from raw fields: %j', (delivery) => {
    setup({ evidence: evidenceFor({ ...worst, ...delivery }) });
    expect(screen.queryByText(/Creative fatigue|Insufficient data|No fatigue signal detected/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ad set signal')).not.toBeInTheDocument();
  });
  it('styles comparison evidence neutrally', () => {
    const { container } = setup();
    expect(container.querySelector('.text-signal-kill, .text-signal-scale')).toBeNull();
  });
  it('counts the subject within the reporting cohort', () => {
    setup({ evidence: evidenceFor(worst, 4), comparisonEnvelope: envelope({ rankableCount: 4, comparableCount: 4 }) });
    expect(screen.getByText('Compared within 4 reporting ad sets with comparable evidence')).toBeInTheDocument();
    expect(screen.queryByText(/Compared against/)).not.toBeInTheDocument();
  });
  it.each([
    ['ctr', -0.34, '34% below campaign', '0.32%', '1.64%'],
    ['roas', -0.34, '34% below campaign', '1.40x', '2.00x'],
    ['frequency', 0.42, '42% above campaign', '3.90', '2.00'],
    ['frequency', 0, 'matches campaign', '3.90', '2.00'],
  ])('renders %s units and the signed server relation neutrally', (metric, gap, copy, childValue, parentValue) => {
    const { container } = setup({ parent: { ctr: 0.0164, roas: 2, frequency: 2 },
      evidence: { ...evidenceFor({ ...worst, roas: 1.4, frequency: 3.9, _gap: gap }), metric } });
    expect(screen.getByText(childValue)).toBeInTheDocument();
    expect(screen.getByText(parentValue)).toBeInTheDocument();
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(container.querySelector('.text-signal-kill, .text-signal-scale')).toBeNull();
  });
});

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
    expect(screen.getByText('80% below campaign')).toBeInTheDocument();
  });

  // Quoted from the SERVER's ranked cohort. Picked from 3 is a weaker claim than
  // picked from 30, and the count must describe the comparison that actually ran.
  it('quotes how many ad sets the server compared', () => {
    setup({ evidence: evidenceFor(worst, 5), comparisonEnvelope: envelope({ rankableCount: 5, comparableCount: 5 }) });
    expect(screen.getByText('Compared within 5 reporting ad sets with comparable evidence')).toBeInTheDocument();
  });

  it('shows the ad set CTR and its gap against the campaign rate', () => {
    setup();
    expect(screen.getByText('0.32%')).toBeInTheDocument();
    expect(screen.getByText('-80%')).toBeInTheDocument();
  });

  it('shows reported spend without a comparison share', () => {
    setup();
    expect(screen.queryAllByText(/% of campaign/)).toHaveLength(0);
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

describe('ExecutionContext — the ask', () => {
  it('asks the marketer to inspect, never to pause outright', () => {
    setup();
    expect(screen.getByText(/^Inspect /)).toBeInTheDocument();
    expect(screen.queryByText(/^Pause /)).not.toBeInTheDocument();
    expect(screen.queryByText(/pause it now|pause immediately/i)).not.toBeInTheDocument();
  });

  // Pausing is offered as something the marketer decides once they have looked
  // — the data cannot see a learning phase or a deliberate test.
  it('adds no pause recommendation from the comparison', () => {
    setup();
    expect(screen.queryByText(/consider pausing/i)).not.toBeInTheDocument();
  });

  it('quotes the gap magnitude in the action sentence', () => {
    setup();
    expect(screen.getByText('-80%')).toBeInTheDocument();
    expect(screen.getByText('80% below campaign')).toBeInTheDocument();
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
