import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceChart } from '../PerformanceChart.jsx';

const empty = { status: 'EMPTY', reason: 'NO_SCORED_SPEND', currency: null,
  totalSpendMinor: null, killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null,
  killPct: null, holdPct: null, scalePct: null };
describe('PerformanceChart — published empty state', () => {
  it('successful no-scored-spend is neutral absence, never CSV advice', () => {
    render(<PerformanceChart budgetDistribution={empty} />);
    expect(screen.getByText(/no scored campaign spend to distribute yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Upload a CSV/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('empty alone cannot establish that Meta needs connecting', () => {
    render(<PerformanceChart budgetDistribution={empty} />);
    expect(screen.queryByText(/Connect Meta/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
  it('available publication still renders the allocation bar', () => {
    render(<PerformanceChart budgetDistribution={{ status: 'AVAILABLE', reason: null, currency: 'USD',
      totalSpendMinor: 1000, killSpendMinor: 0, holdSpendMinor: 1000, scaleSpendMinor: 0,
      killPct: 0, holdPct: 100, scalePct: 0 }} />);
    expect(screen.getByRole('img', { name: /Allocation:/i })).toBeInTheDocument();
    expect(screen.queryByText(/no scored campaign spend/i)).not.toBeInTheDocument();
  });
});
