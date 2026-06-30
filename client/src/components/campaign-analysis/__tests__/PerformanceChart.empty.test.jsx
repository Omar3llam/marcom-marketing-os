// ============================================================
// PerformanceChart (Budget Allocation) — empty message agrees with the page
// ------------------------------------------------------------
// `totals` already prefers the live connector (chartTotals), so spend 0 means no
// spend anywhere. The empty message must NOT say "Upload a CSV" when connector
// data exists (that contradicted the live verdicts elsewhere on the page); it
// offers both paths only when nothing is connected. With real spend it renders
// the allocation bar unchanged.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceChart } from '../PerformanceChart.jsx';

describe('PerformanceChart — connector-aware empty state', () => {
  it('no spend but connector data exists → "no spend to allocate yet", never "Upload a CSV"', () => {
    render(<PerformanceChart totals={{ spend: 0, kill: 0, hold: 0, scale: 0 }} hasConnectorData />);
    expect(screen.getByText(/no spend to allocate yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Upload a CSV/i)).not.toBeInTheDocument();
  });

  it('no spend and nothing connected → honest dual-path message', () => {
    render(<PerformanceChart totals={{ spend: 0, kill: 0, hold: 0, scale: 0 }} hasConnectorData={false} />);
    expect(screen.getByText(/Connect Meta or upload a CSV/i)).toBeInTheDocument();
  });

  it('real spend → renders the allocation bar (no empty state)', () => {
    render(<PerformanceChart totals={{ spend: 1000, kill: 0, hold: 1000, scale: 0 }} hasConnectorData />);
    expect(screen.getByRole('img', { name: /Allocation:/i })).toBeInTheDocument();
    expect(screen.queryByText(/no spend to allocate/i)).not.toBeInTheDocument();
  });
});
