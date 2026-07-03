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
import { MetricsPanel } from '../MetricsPanel.jsx';

describe('MetricsPanel — source-resolved, null-honest KPI strip', () => {
  it('live connector: real spend + "Live · connector", never the stale CSV-derived label', () => {
    render(
      <MetricsPanel
        spend={1234} spendLabel="Live · connector" blendedCpa={null}
        wasted={null} wastedPct={null} healthScore={null} healthLabel="Sync Meta to see health"
        healthColor="text-lumi-muted" currency="USD"
      />,
    );
    expect(screen.getByText(/\$1,234/)).toBeInTheDocument();
    expect(screen.getByText('Live · connector')).toBeInTheDocument();
    expect(screen.queryByText(/CSV-derived/)).not.toBeInTheDocument();
  });

  it('Wasted Spend with no analysis backing renders "—" + "Needs analysis", not $0.00', () => {
    render(
      <MetricsPanel
        spend={500} spendLabel="Live · connector" blendedCpa={null}
        wasted={null} wastedPct={null} healthScore={null} healthLabel="Sync Meta to see health"
        healthColor="text-lumi-muted" currency="USD"
      />,
    );
    expect(screen.getByText('Needs analysis')).toBeInTheDocument();
    expect(screen.getByText('No conversions tracked yet')).toBeInTheDocument(); // blendedCpa null → honest
  });

  it('no source at all: Total Spend shows "—" + "No data yet" (no fabricated 0)', () => {
    render(
      <MetricsPanel
        spend={null} spendLabel="No data yet" blendedCpa={null}
        wasted={null} wastedPct={null} healthScore={null} healthLabel="Sync Meta to see health"
        healthColor="text-lumi-muted" currency="USD"
      />,
    );
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    // The Total Spend card value is an em-dash, not "$0.00".
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});
