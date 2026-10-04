import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatCurrency } from '@/lib/money';
import { PerformanceChart } from '../PerformanceChart.jsx';

const available = { status: 'AVAILABLE', reason: null, currency: 'EGP', totalSpendMinor: 100000,
  killSpendMinor: 24990, holdSpendMinor: 50020, scaleSpendMinor: 24990,
  killPct: 24.99, holdPct: 50.02, scalePct: 24.99 };
const absent = (status, reason) => ({ status, reason, currency: null, totalSpendMinor: null,
  killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
const view = (budgetDistribution, extra = {}) => render(<PerformanceChart
  budgetDistribution={budgetDistribution} {...extra} />);
const noNumbers = () => {
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Connect Meta/i)).not.toBeInTheDocument();
  const section = screen.getByText('Scored campaign spend distribution').closest('section');
  expect(section.querySelector('[style*="width"]')).toBeNull();
  expect(section).not.toHaveTextContent(/EGP|USD|ج\.م|\$|Total scored spend/);
  expect(section.querySelector('li')).toBeNull();
};
const labels = ['Kill', 'Hold / Watch / Reallocate / Refresh', 'Scale'];
const row = (label) => screen.getByText(label).closest('li');
describe('SC-17A budget publication rendering', () => {
  it('names the scored-spend population without a budget or period claim', () => {
    view(available);
    expect(screen.getByText('Scored campaign spend distribution')).toBeInTheDocument();
    expect(screen.getByText('Positive spend on campaigns with a current LUMI verdict.')).toBeInTheDocument();
    expect(screen.queryByText('Current Budget Distribution')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/allocation|account spend|today|this month|last 30 days/i);
  });
  it('carries evidence in visible text without Allocation image or progress semantics', () => {
    view(available);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label*="Allocation"]')).toBeNull();
    expect(screen.getAllByText('24.99%')).toHaveLength(2);
    expect(screen.getByText('50.02%')).toBeInTheDocument();
  });
  it('displays the exact published total, currency and each lane amount', () => {
    view(available);
    const total = screen.getByText('Total scored spend').parentElement;
    expect(total).toHaveTextContent('EGP');
    expect(total.textContent).toContain(formatCurrency(100000, 'EGP'));
    [24990, 50020, 24990].forEach((amount, index) => {
      expect(row(labels[index]).textContent).toContain(formatCurrency(amount, 'EGP'));
    });
  });
  it('discloses all middle-lane members with neutral presentation', () => {
    view(available);
    const middle = row(labels[1]);
    expect(middle).toBeInTheDocument();
    expect(middle.querySelector('.bg-signal-hold, .text-signal-hold')).toBeNull();
    expect(middle.querySelector('[style]').className).toContain('bg-lumi-muted');
  });
  it.each([
    [[24.99, 50.02, 24.99]],
    [[33.33, 33.33, 33.33]],
    [[16.67, 66.67, 16.67]],
  ])('uses independent tracks for published shares %j without repairing their sum', (shares) => {
    view({ ...available, killPct: shares[0], holdPct: shares[1], scalePct: shares[2] });
    expect(document.querySelectorAll('[style*="width"]')).toHaveLength(3);
    labels.forEach((label, index) => {
      const lane = row(label);
      expect(within(lane).getByText(`${shares[index]}%`)).toBeInTheDocument();
      const fill = lane.querySelector('[style]');
      expect(fill).toHaveStyle({ width: `${shares[index]}%` });
      expect(fill.parentElement).toHaveAttribute('aria-hidden', 'true');
      expect(fill.parentElement.children).toHaveLength(1);
      expect(fill.parentElement.classList.contains('flex')).toBe(false);
    });
    expect(screen.queryByText('33.34%')).not.toBeInTheDocument();
  });
  it('never derives shares from published monetary amounts', () => {
    view({ ...available, totalSpendMinor: 1000, killSpendMinor: 250, holdSpendMinor: 500, scaleSpendMinor: 250 });
    expect(within(row(labels[1])).getByText('50.02%')).toBeInTheDocument();
    expect(row(labels[1]).querySelector('[style]')).toHaveStyle({ width: '50.02%' });
    expect(row(labels[1]).textContent).toContain(formatCurrency(500, 'EGP'));
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
    const { rerender } = view(available);
    rerender(<PerformanceChart budgetDistribution={available} loading />); noNumbers();
    expect(screen.getByRole('status')).toHaveTextContent(/loading scored campaign spend distribution/i);
    expect(screen.queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it('failed read suppresses older publication and does not render empty', () => {
    view(available, { error: new Error('network') }); noNumbers();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load scored campaign spend distribution/i);
    expect(screen.queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it.each([null, { status: 'UNKNOWN' }])('missing or unknown publication is an error, never an empty claim: %j', (publication) => {
    view(publication); noNumbers();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
