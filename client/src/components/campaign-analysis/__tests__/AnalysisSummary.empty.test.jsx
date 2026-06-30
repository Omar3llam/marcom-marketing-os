// ============================================================
// AnalysisSummary — the empty state must agree with the rest of the page
// ------------------------------------------------------------
// The CSV-analysis table used to shout "No campaigns analyzed yet — upload a CSV"
// even when live connector verdicts were rendering below it (two contradictory
// states at once). The empty state is now connector-aware: it never claims the
// page is empty when connector data exists, and offers BOTH paths when it is
// genuinely empty. The two substrates stay disjoint — connector rows are NOT
// pulled into this table; only the messaging is made honest.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisSummary } from '../AnalysisSummary.jsx';

const base = {
  rows: [], loading: false, sortKey: 'spend', sortDir: 'desc',
  setSort: () => {}, expanded: new Set(), setExpanded: () => {}, onUpload: () => {},
};

describe('AnalysisSummary — empty state is connector-aware (no contradiction)', () => {
  it('connector data exists, no CSV → points to the live section, NOT "No campaigns analyzed yet"', () => {
    render(<AnalysisSummary {...base} hasConnectorData />);
    expect(screen.getByText(/Live verdicts are shown below/i)).toBeInTheDocument();
    expect(screen.queryByText(/No campaigns analyzed yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('genuinely empty (no CSV, no connector) → honest dual-path message', () => {
    render(<AnalysisSummary {...base} hasConnectorData={false} />);
    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect your Meta account or upload a CSV/i)).toBeInTheDocument();
    // never the old CSV-exclusive contradiction
    expect(screen.queryByText(/No campaigns analyzed yet/i)).not.toBeInTheDocument();
  });

  it('CSV rows present → renders the analysis table, no empty state (existing behavior preserved)', () => {
    const rows = [{
      id: 'a1', campaign: 'Eid Sale', platform: 'META', spend: 1000, ctr: 1.2,
      roas: 4.2, freq: 2.1, verdict: 'SCALE', impact: 4, reasoning: 'Strong ROAS', currency: 'USD',
    }];
    render(<AnalysisSummary {...base} rows={rows} hasConnectorData={false} />);
    expect(screen.getByText('Eid Sale')).toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live verdicts are shown below/i)).not.toBeInTheDocument();
  });
});
