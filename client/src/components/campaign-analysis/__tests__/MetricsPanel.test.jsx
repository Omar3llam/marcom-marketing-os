// ============================================================
// MetricsPanel — the KPI strip reads its real source, honestly
// ------------------------------------------------------------
// The strip used to hardcode "Live · CSV-derived" and render fmtCurrency(0) even
// when the live connector (not CSV) was the substrate feeding the page — a $0.00
// that asserted a source that wasn't there. These assert the source-resolved,
// null-honest behavior: live spend shows the live label; an absent metric shows
// "—", never a fabricated 0 or a stale source claim.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetricsPanel } from '../MetricsPanel.jsx';

// Blended CPA null now renders an "Add revenue data" Link → needs a Router.
const renderPanel = (props) => render(<MemoryRouter><MetricsPanel {...props} /></MemoryRouter>);

describe('MetricsPanel — source-resolved, null-honest KPI strip', () => {
  it('live connector: real spend + "Live · connector", never the stale CSV-derived label', () => {
    renderPanel({
      spend: 1234, spendLabel: 'Live · connector', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText(/\$1,234/)).toBeInTheDocument();
    expect(screen.getByText('Live · connector')).toBeInTheDocument();
    expect(screen.queryByText(/CSV-derived/)).not.toBeInTheDocument();
  });

  it('Wasted Spend with no analysis backing renders "—" + "Needs analysis", not $0.00', () => {
    renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText('Needs analysis')).toBeInTheDocument();
    expect(screen.getByText('No conversions tracked yet')).toBeInTheDocument(); // blendedCpa null → honest
  });

  it('no source at all: Total Spend shows "—" + "No data yet" (no fabricated 0)', () => {
    renderPanel({
      spend: null, spendLabel: 'No data yet', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    // The Total Spend card value is an em-dash, not "$0.00".
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('offers the "Add revenue data" CTA only when Blended CPA is unknown', () => {
    const { unmount } = renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: '—', healthColor: '', currency: 'USD',
    });
    const cta = screen.getByRole('link', { name: /Add revenue data to unlock ROAS/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
    unmount();

    // Real CPA present → no CTA (nothing to unlock).
    renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: 4200,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: '—', healthColor: '', currency: 'USD',
    });
    expect(screen.queryByRole('link', { name: /Add revenue data/i })).not.toBeInTheDocument();
  });
});
