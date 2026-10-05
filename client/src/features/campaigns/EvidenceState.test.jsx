// ============================================================
// EvidenceState — three non-answers, three treatments
// ------------------------------------------------------------
// The component exists so the Campaigns table and the Overview card cannot drift
// on what a refusal looks like. What is pinned here is the DISTINCTION: a
// refusal is not painted as a failure, because "no ad set is measurably behind
// the others" is good news about a real campaign, and red would report it as a
// fault the operator has to fix.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceState } from './EvidenceState.jsx';

describe('EvidenceState', () => {
  it.each(['ad', 'adset'])('P7-07A preserves a comparability refusal at %s level', (dimension) => {
    render(<EvidenceState dimension={dimension} reasonKey="COMPARISON_ENVELOPE_UNAVAILABLE" />);
    expect(screen.getByText('These measurements do not share enough comparable evidence to rank reliably.')).toBeInTheDocument();
    expect(screen.queryByText(/Not enough|Couldn’t|Connect|No .*measurably/)).not.toBeInTheDocument();
  });
  it.each(['ad', 'adset'])('renders permanent failures neutrally at %s dimension', (dimension) => {
    const { container, rerender } = render(<EvidenceState dimension={dimension} error="RoleForbidden"
      failure={{ kind: 'NOT_PERMITTED', retryable: false }} reasonKey="NO_MEANINGFUL_GAP" />);
    expect(screen.getByText('Evidence isn’t available for this seat.')).toBeInTheDocument();
    expect(screen.queryByText(/try again|measurably behind/)).not.toBeInTheDocument();
    expect(container.querySelector('.text-trend-danger')).toBeNull();
    rerender(<EvidenceState dimension={dimension} error="bad"
      failure={{ kind: 'CONTRACT_INVALID', retryable: false }} />);
    expect(screen.getByText('Couldn’t read the evidence response.')).toBeInTheDocument();
    expect(screen.queryByText(/try again/)).not.toBeInTheDocument();
  });
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<EvidenceState />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once a real ranking has arrived', () => {
    // The caller passes no reasonKey on success; this component must then get
    // out of the way of the panel it sits above.
    const { container } = render(<EvidenceState loading={false} error={null} reasonKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is checking, rather than showing an empty space', () => {
    render(<EvidenceState loading />);
    expect(screen.getByText(/Checking ad set performance/)).toBeInTheDocument();
  });

  it('reports a failed request as a failure, and says it is retryable', () => {
    const { container } = render(<EvidenceState error="Network Error" />);
    expect(screen.getByText(/Couldn't load evidence/)).toBeInTheDocument();
    expect(container.querySelector('.text-trend-danger')).not.toBeNull();
  });

  it('renders a refusal in the subtle tone, NOT the danger tone', () => {
    const { container } = render(<EvidenceState reasonKey="NO_MEANINGFUL_GAP" />);
    expect(screen.getByText(/No ad set is measurably behind the others/)).toBeInTheDocument();
    // The load-bearing assertion: a healthy answer must not be painted red.
    expect(container.querySelector('.text-trend-danger')).toBeNull();
    expect(container.querySelector('.text-lumi-subtle')).not.toBeNull();
  });

  it('names the missing input per reason key', () => {
    const { rerender } = render(<EvidenceState reasonKey="INSUFFICIENT_REPORTING_ADSETS" />);
    expect(screen.getByText(/Not enough reporting ad sets to compare/)).toBeInTheDocument();

    rerender(<EvidenceState reasonKey="BASELINE_UNAVAILABLE" />);
    expect(screen.getByText(/No campaign performance data to compare against yet/)).toBeInTheDocument();
  });

  it('falls back to a general sentence for a key it has never seen', () => {
    render(<EvidenceState reasonKey="SOMETHING_THE_SERVER_ADDED_LATER" />);
    expect(screen.getByText(/Not enough data to compare ad sets/)).toBeInTheDocument();
  });

  it('loading wins over a stale refusal — one line at a time', () => {
    render(<EvidenceState loading reasonKey="NO_MEANINGFUL_GAP" />);
    expect(screen.getByText(/Checking ad set performance/)).toBeInTheDocument();
    expect(screen.queryByText(/No ad set is measurably behind/)).not.toBeInTheDocument();
  });

  it('an error wins over a refusal — a failed request has no verdict to report', () => {
    render(<EvidenceState error="boom" reasonKey="NO_MEANINGFUL_GAP" />);
    expect(screen.getByText(/Couldn't load evidence/)).toBeInTheDocument();
    expect(screen.queryByText(/No ad set is measurably behind/)).not.toBeInTheDocument();
  });
});

// ── The same three treatments, one level down ───────────────
// The server publishes ONE reason enum for both dimensions, so this component
// serves both. Only the NOUNS move: a refusal about ad sets, printed under a
// list of ads, is a true sentence about the wrong entity.
describe('EvidenceState — the ad dimension', () => {
  it('says what it is checking at this level', () => {
    render(<EvidenceState loading dimension="ad" />);
    expect(screen.getByText(/Checking creative performance/)).toBeInTheDocument();
  });

  it('refuses in the reader’s own vocabulary', () => {
    render(<EvidenceState reasonKey="NO_MEANINGFUL_GAP" dimension="ad" />);
    expect(screen.getByText('No ad is measurably behind the others')).toBeInTheDocument();
  });

  it('names the ad set as the baseline, not the campaign', () => {
    render(<EvidenceState reasonKey="BASELINE_UNAVAILABLE" dimension="ad" />);
    expect(screen.getByText('No ad set performance data to compare against yet')).toBeInTheDocument();
  });

  it('treats a refusal as a refusal here too — not the danger colour', () => {
    const { container } = render(<EvidenceState reasonKey="INSUFFICIENT_REPORTING_ADS" dimension="ad" />);
    expect(container.querySelector('.text-trend-danger')).toBeNull();
  });

  it('reports a real failure identically at both levels', () => {
    const { container } = render(<EvidenceState error="Network Error" dimension="ad" />);
    expect(container.querySelector('.text-trend-danger')).not.toBeNull();
  });

  it('defaults to the ad-set wording, so every existing caller is unchanged', () => {
    render(<EvidenceState loading />);
    expect(screen.getByText(/Checking ad set performance/)).toBeInTheDocument();
  });

  it('degrades an unknown dimension rather than rendering a blank', () => {
    render(<EvidenceState loading dimension="placement" />);
    expect(screen.getByText(/Checking ad set performance/)).toBeInTheDocument();
  });
});
