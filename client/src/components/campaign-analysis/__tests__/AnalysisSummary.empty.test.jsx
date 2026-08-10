// ============================================================
// AnalysisSummary — the empty state must agree with the rest of the page
// ------------------------------------------------------------
// The CSV-analysis table used to shout "No campaigns analyzed yet — upload a CSV"
// even when live connector verdicts were rendering below it (two contradictory
// states at once). The empty state is now connector-aware. When connector data
// exists it renders NOTHING — a tall "verdicts are shown below" placeholder was
// pure redundancy (the live Connected-channels table sits right underneath) and
// only pushed the real table off-screen. When genuinely empty it points to
// connecting Meta. Loading / channel-filter empties still surface. The two
// substrates stay disjoint — connector rows are NOT pulled into this table.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisSummary } from '../AnalysisSummary.jsx';

const base = {
  rows: [], loading: false, sortKey: 'spend', sortDir: 'desc',
  setSort: () => {}, expanded: new Set(), setExpanded: () => {},
};

describe('AnalysisSummary — empty state is connector-aware (no contradiction)', () => {
  it('connector data exists, no CSV → renders NOTHING (the live table below is self-explanatory)', () => {
    const { container } = render(<AnalysisSummary {...base} hasConnectorData />);
    expect(container).toBeEmptyDOMElement();
    // no redundant placeholder, and it never falsely claims the page is empty
    expect(screen.queryByText(/Live verdicts are shown below/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('connector data + loading → still shows the loading state (not swallowed)', () => {
    render(<AnalysisSummary {...base} hasConnectorData loading />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('connector data + active channel filter with no rows → still shows the filter message', () => {
    render(<AnalysisSummary {...base} hasConnectorData emptyChannel="Google" />);
    expect(screen.getByText(/No Google campaigns/i)).toBeInTheDocument();
  });

  it('genuinely empty (nothing connected) → connect-Meta message, no CSV', () => {
    render(<AnalysisSummary {...base} hasConnectorData={false} />);
    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect a channel to get started/i)).toBeInTheDocument();
    expect(screen.queryByText(/upload a CSV/i)).not.toBeInTheDocument();
    // never the old CSV-exclusive contradiction
    expect(screen.queryByText(/No campaigns analyzed yet/i)).not.toBeInTheDocument();
  });

  it('CSV rows present → renders the analysis table, no empty state (existing behavior preserved)', () => {
    const rows = [{
      id: 'a1', campaign: 'Eid Sale', platform: 'META', spend: 1000, ctr: 1.2,
      roas: 4.2, freq: 2.1, verdict: 'SCALE', reasoning: 'Strong ROAS', currency: 'USD',
    }];
    render(<AnalysisSummary {...base} rows={rows} hasConnectorData={false} />);
    expect(screen.getByText('Eid Sale')).toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live verdicts are shown below/i)).not.toBeInTheDocument();
  });
});

// ── The governing boundary: no number without a row behind it ─────────────────
// The legacy table used to print an Impact score derived ONLY from the verdict
// (KILL→9, HOLD→6, SCALE→4, else 5) as "6/10" next to a progress bar. It traced
// to no DB row, and it contradicted the canonical spend-weighted impact score
// rendering a few hundred pixels above it on the same page.
//
// These tests are deliberately HOSTILE: the fixture row still carries an
// `impact` field, exactly as a reintroduced verdict→number calculation would
// hand it over. The assertions are that the component IGNORES it. So this fails
// on any re-added column regardless of what formula produced the value, and it
// pins no specific number — the old mapping is not the thing being protected,
// the boundary is.
describe('AnalysisSummary — a legacy row renders no fabricated impact', () => {
  const hostileRow = {
    id: 'a1', campaign: 'Eid Sale', platform: 'META', spend: 1000, ctr: 1.2,
    roas: 4.2, freq: 2.1, verdict: 'SCALE', reasoning: 'Strong ROAS', currency: 'USD',
    impact: 7, // ← a value the table must refuse to render
  };
  const renderRow = () =>
    render(<AnalysisSummary {...base} rows={[hostileRow]} hasConnectorData={false} />);

  it('renders no X/10 impact cell, whatever the row carries', () => {
    const { container } = renderRow();
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*10/);
    expect(screen.queryByText('7/10')).not.toBeInTheDocument();
  });

  it('renders no impact progress bar', () => {
    renderRow();
    // InlineBar's role. The legacy table has no measured 0–10 quantity to bar.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/impact/i)).not.toBeInTheDocument();
  });

  it('has no Impact column header — and is 7 columns, not 8', () => {
    renderRow();
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(headers).not.toContain('Impact');
    expect(headers).toEqual(['Campaign', 'Spend', 'CTR', 'ROAS', 'Freq', 'Decision', 'Reasoning']);
  });

  it('still renders the columns that DO trace to the feed (this is a deletion, not a gutting)', () => {
    renderRow();
    expect(screen.getByText('Eid Sale')).toBeInTheDocument();
    expect(screen.getByText('4.20x')).toBeInTheDocument();   // real ROAS from the row
    expect(screen.getByText('Strong ROAS')).toBeInTheDocument();
  });
});
