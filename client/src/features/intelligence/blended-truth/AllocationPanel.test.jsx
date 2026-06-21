// ============================================================
// AllocationPanel — preview-then-commit capital allocation (pure view)
// ------------------------------------------------------------
// Asserts the budget→minor conversion on preview, the honest no-channels note,
// the proposed-plan render (per-channel moves + projected MER), the STRATEGIST-
// gated commit, and honest in-flight / error / committed states.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AllocationPanel } from './AllocationPanel.jsx';

const PLAN = {
  goal: { type: 'GROWTH_CEILING', value: null },
  totalBudgetMinor: 5000000, currency: 'USD',
  allocations: [
    { channelId: 'meta', channel: 'Meta', verdict: 'SCALE', currentSpendMinor: 3000000, recommendedSpendMinor: 3500000, deltaMinor: 500000, blendedRoas: 2.4, rationale: 'higher blended ROAS' },
    { channelId: 'google', channel: 'Google', verdict: 'TRIM', currentSpendMinor: 2000000, recommendedSpendMinor: 1500000, deltaMinor: -500000, blendedRoas: 1.1, rationale: 'lower blended ROAS' },
  ],
  projected: { blendedRevenueMinor: 12000000, projectedCpaMinor: 4500, merBefore: 1.8, merAfter: 2.2 },
  reasoningTrail: [],
};

describe('AllocationPanel — preview', () => {
  it('converts the major-unit budget to minor units and fires onPreview', () => {
    const onPreview = vi.fn();
    render(<AllocationPanel currency="USD" onPreview={onPreview} />);
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /preview allocation/i }));
    expect(onPreview).toHaveBeenCalledWith({ totalBudgetMinor: 5000000 }); // 50000 * 100
  });

  it('keeps Preview disabled until a positive budget is entered', () => {
    render(<AllocationPanel currency="USD" onPreview={vi.fn()} />);
    expect(screen.getByRole('button', { name: /preview allocation/i })).toBeDisabled();
  });

  it('shows the honest no-channels note (not a fabricated split)', () => {
    render(<AllocationPanel currency="USD" previewNote="No connected channels to allocate." />);
    expect(screen.getByText(/No connected channels to allocate/i)).toBeInTheDocument();
  });

  it('surfaces the real preview error', () => {
    render(<AllocationPanel currency="USD" previewError={new Error('Request failed')} />);
    expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
  });
});

describe('AllocationPanel — proposed plan + commit', () => {
  it('renders the per-channel moves and the projected MER', () => {
    render(<AllocationPanel currency="USD" plan={PLAN} canCommit />);
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('1.8×')).toBeInTheDocument();   // merBefore
    expect(screen.getByText('2.2×')).toBeInTheDocument();   // merAfter
  });

  it('a strategist sees Commit; clicking fires onCommit with the budget', () => {
    const onCommit = vi.fn();
    render(<AllocationPanel currency="USD" plan={PLAN} canCommit onCommit={onCommit} />);
    // a budget must be present for commit to be enabled
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '50000' } });
    const btn = screen.getByRole('button', { name: /commit allocation/i });
    fireEvent.click(btn);
    expect(onCommit).toHaveBeenCalledWith({ totalBudgetMinor: 5000000 });
  });

  it('hides Commit when the viewer cannot commit (non-strategist)', () => {
    render(<AllocationPanel currency="USD" plan={PLAN} canCommit={false} />);
    expect(screen.queryByRole('button', { name: /commit allocation/i })).not.toBeInTheDocument();
  });

  it('reflects in-flight commit + surfaces a real commit error', () => {
    const { rerender } = render(<AllocationPanel currency="USD" plan={PLAN} canCommit committing />);
    expect(screen.getByRole('button', { name: /committing/i })).toBeDisabled();
    rerender(<AllocationPanel currency="USD" plan={PLAN} canCommit commitError={new Error('No resolvable workspace.')} />);
    expect(screen.getByText(/No resolvable workspace/i)).toBeInTheDocument();
  });

  it('confirms a successful commit with the real proposed-move count', () => {
    render(<AllocationPanel currency="USD" plan={PLAN} canCommit committed={{ planId: 'p1', decisionsCreated: 2 }} />);
    expect(screen.getByText(/Committed — 2 proposed moves/i)).toBeInTheDocument();
  });
});
