// ============================================================
// AdRows — four outcomes, and a refusal is not one of the failures
// ============================================================
// The ad level inherits the honesty rules of the two above it, and adds one the
// campaign level never had to make: the ads can load perfectly while the RANKING
// declines. "Not enough reporting ads to compare" under a list of four ads is a
// true, useful sentence; rendering it in the error treatment would tell the
// operator the request broke, and rendering nothing would look like a bug.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdRows } from './AdRows.jsx';

const comparisonEnvelope = { status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0 };

const ad = (over = {}) => ({
  entityId: 'ad-1', name: 'Hook A · 9x16', channel: 'META', status: 'ACTIVE',
  ctr: 0.0138, frequency: 2.1, spendMinor: 90_000, currency: 'USD', ...over,
});

const ranking = (over = {}) => ({
  entity: { entityId: 'as-1', ctr: 0.0164 },
  objective: 'OUTCOME_SALES',
  evidence: {
    dimension: 'AD', metric: 'ctr',
    ranked: [ad({ entityId: 'ad-2', ctr: 0.0091 }), ad()],
    summary: {
      bottom: ad({ entityId: 'ad-2', name: 'Hook B · 1x1', ctr: 0.0091, _gap: -0.34, platformCreatedTime: '2026-06-14T00:00:00.000Z' }),
      top: ad(),
      outliers: [],
    },
    dataConfidence: 0.7,
  },
  comparisonEnvelope, insufficientData: false, reasonKey: null,
  ...over,
});

// A <tbody> host, because these are <tr>s: a bare div parent makes the browser
// reparent them out and the queries below find nothing.
const renderRows = (props) => render(
  <table><tbody><AdRows cols={5} {...props} /></tbody></table>,
);

describe('P7-04B ad comparison parent', () => {
  it('keeps the evidence parent, summary selection and published gap together', () => {
    const entry = ranking({ entity: { ctr: 0.02 } });
    entry.evidence.ranked = [ad({ name: 'Decoy' }), ad()];
    renderRows({ state: { children: [ad()] }, evidence: entry });
    expect(screen.getByText('Hook B · 1x1')).toBeInTheDocument();
    expect(screen.getByText('2.00%')).toBeInTheDocument();
    expect(screen.getByText('-34%')).toBeInTheDocument();
    expect(screen.queryByText('Decoy')).not.toBeInTheDocument();
  });
});

describe('the four states of an ad expansion', () => {
  it('says it is loading while the fetch is in flight', () => {
    renderRows({ loading: true });
    expect(screen.getByText(/Loading ads/)).toBeInTheDocument();
  });

  // Nothing back and no error yet is still in flight — a committed empty state
  // here would flash "no ads" over an ad set that has plenty.
  it('says it is loading before the first answer arrives', () => {
    renderRows({ state: null });
    expect(screen.getByText(/Loading ads/)).toBeInTheDocument();
  });

  it('says the request failed, and that collapsing retries it', () => {
    renderRows({ error: 'Network Error' });
    expect(screen.getByText(/Couldn’t load ads/)).toBeInTheDocument();
  });

  it('says an empty ad set is empty, rather than showing nothing', () => {
    renderRows({ state: { children: [] } });
    expect(screen.getByText(/No ads synced for this ad set yet/)).toBeInTheDocument();
  });

  it('renders the ads once they arrive', () => {
    renderRows({ state: { children: [ad(), ad({ entityId: 'ad-2', name: 'Hook B · 1x1' })] } });
    expect(screen.getByText('Hook A · 9x16')).toBeInTheDocument();
    expect(screen.getByText('Hook B · 1x1')).toBeInTheDocument();
  });

  // The server orders by creative age, oldest first — the order the fatigue
  // question is asked in. A client-side re-sort would answer a different one.
  it('renders them in the order the server sent', () => {
    const { container } = renderRows({ state: { children: [
      ad({ entityId: 'a', name: 'Oldest' }),
      ad({ entityId: 'b', name: 'Middle' }),
      ad({ entityId: 'c', name: 'Newest' }),
    ] } });
    const t = container.textContent;
    expect(t.indexOf('Oldest')).toBeLessThan(t.indexOf('Middle'));
    expect(t.indexOf('Middle')).toBeLessThan(t.indexOf('Newest'));
  });

  it('survives a malformed body without claiming the request failed', () => {
    renderRows({ state: { children: null } });
    expect(screen.getByText(/No ads synced/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument();
  });
});

describe('the metrics on each row', () => {
  it('are the real stored figures', () => {
    renderRows({ state: { children: [ad()] } });
    expect(screen.getByText('1.38%')).toBeInTheDocument();
    expect(screen.getByText('2.10')).toBeInTheDocument();
  });

  it('render a dash when unreported, never a zero', () => {
    const { container } = renderRows({ state: { children: [ad({ ctr: null, frequency: null })] } });
    expect(screen.getAllByLabelText('No data')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/0\.00/);
  });
});

describe('the ranking, and the three ways it can decline', () => {
  it('shows Creative Intelligence when the server ranked the ads', () => {
    renderRows({ state: { children: [ad()] }, evidence: ranking() });
    expect(screen.getByText('Creative intelligence')).toBeInTheDocument();
    expect(screen.getByText('Hook B · 1x1')).toBeInTheDocument();
    expect(screen.getByText(/34% below the ad set/)).toBeInTheDocument();
  });

  it('reads the age off the ranked ad', () => {
    renderRows({ state: { children: [ad()] }, evidence: ranking() });
    expect(screen.getByText(/14 Jun 2026/)).toBeInTheDocument();
  });

  // The distinction the whole evidence contract exists for.
  it('a refusal is a sentence, not an error', () => {
    renderRows({
      state: { children: [ad()] },
      evidence: { evidence: null, insufficientData: true, reasonKey: 'INSUFFICIENT_REPORTING_ADS' },
    });
    expect(screen.getByText('Not enough reporting ads to compare')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load evidence/)).not.toBeInTheDocument();
    expect(screen.queryByText('Creative intelligence')).not.toBeInTheDocument();
  });

  // The nouns follow the level. "No ad set is measurably behind the others",
  // printed under four ads, is a true refusal about the wrong entity.
  it('a refusal speaks about ads, not about ad sets', () => {
    renderRows({
      state: { children: [ad()] },
      evidence: { evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' },
    });
    expect(screen.getByText('No ad is measurably behind the others')).toBeInTheDocument();
  });

  it('the baseline it names is the ad set, not the campaign', () => {
    renderRows({
      state: { children: [ad()] },
      evidence: { evidence: null, insufficientData: true, reasonKey: 'BASELINE_UNAVAILABLE' },
    });
    expect(screen.getByText('No ad set performance data to compare against yet')).toBeInTheDocument();
  });

  it('an evidence failure is an error, and says so', () => {
    renderRows({ state: { children: [ad()] }, evidenceError: 'Network Error' });
    expect(screen.getByText(/Couldn't load evidence/)).toBeInTheDocument();
  });

  it('says it is checking while the ranking is in flight', () => {
    renderRows({ state: { children: [ad()] }, evidenceLoading: true });
    expect(screen.getByText(/Checking creative performance/)).toBeInTheDocument();
  });

  // The ads and the ranking are two requests. One resolving first must not
  // commit an empty bordered row under the list.
  it('commits nothing while neither the ranking nor a refusal has arrived', () => {
    const { container } = renderRows({ state: { children: [ad()] } });
    expect(screen.getByText('Hook A · 9x16')).toBeInTheDocument();
    expect(container.querySelectorAll('tr')).toHaveLength(1);
  });

  it('does not rank the ads itself when the server declined to', () => {
    renderRows({
      state: { children: [ad(), ad({ entityId: 'ad-2', ctr: 0.0002 })] },
      evidence: { evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' },
    });
    // Two ads with wildly different CTRs and no server answer: still no finding.
    expect(screen.queryByText('Creative intelligence')).not.toBeInTheDocument();
  });
});
