import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceChart } from '../PerformanceChart.jsx';

const available = { status: 'AVAILABLE', reason: null, currency: 'EGP', totalSpendMinor: 1000,
  killSpendMinor: 250, holdSpendMinor: 500, scaleSpendMinor: 250,
  // Deliberately differs from local spend division: ownership must stay server-side.
  killPct: 24.99, holdPct: 50.02, scalePct: 24.99 };
const absent = (status, reason) => ({ status, reason, currency: null, totalSpendMinor: null,
  killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
const view = (budgetDistribution, extra = {}) => render(<PerformanceChart
  budgetDistribution={budgetDistribution} {...extra} />);
const noNumbers = () => {
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Connect Meta/i)).not.toBeInTheDocument();
};
describe('SC-17A budget publication rendering', () => {
  it('uses published percentages verbatim for text, accessible name and bar widths', () => {
    view(available);
    const bar = screen.getByRole('img', { name: 'Allocation: kill 24.99%, hold 50.02%, scale 24.99%' });
    expect(screen.getByText('Hold · 50.02%')).toBeInTheDocument();
    expect(bar.children[1]).toHaveStyle({ width: '50.02%' });
  });
  it.each([
    ['MIXED_CURRENCY', /currencies cannot be combined/i],
    ['UNKNOWN_CURRENCY', /denomination cannot be established/i],
  ])('%s withholds bar and numeric legend', (reason, message) => {
    view(absent('UNAVAILABLE', reason)); noNumbers();
    expect(screen.getByText(message)).toBeInTheDocument();
  });
  it('successful empty never fabricates 0/0/0 shares or connection advice', () => {
    view(absent('EMPTY', 'NO_SCORED_SPEND')); noNumbers();
    expect(screen.getByText(/no scored campaign spend/i)).toBeInTheDocument();
  });
  it('loading suppresses even an older available publication', () => {
    view(available, { loading: true }); noNumbers();
    expect(screen.getByRole('status')).toHaveTextContent(/loading budget distribution/i);
    expect(screen.queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it('failed read suppresses older publication and does not render empty', () => {
    view(available, { error: new Error('network') }); noNumbers();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load budget distribution/i);
    expect(screen.queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it('missing publication is an error, never an empty claim', () => {
    view(null); noNumbers();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
