import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Any attempted denomination of this historical value fails the test directly.
vi.mock('@/lib/money', () => ({
  formatCurrency: vi.fn(() => { throw new Error('Unproven holdout money reached currency formatting'); }),
}));
import { formatCurrency } from '@/lib/money';
import { IncrementalityPanel } from '../IncrementalityPanel.jsx';
import HoldoutDetailView from '../HoldoutDetailView.jsx';

const historical = {
  id: 'h1', name: 'Meta holdout', channel: 'META', status: 'CONCLUDED',
  liftPct: 20, confidenceLabel: 'MEDIUM', ciLow: 0.001, ciHigh: 0.018,
  incrementalRevenueMinor: 50000, sampleSizePerArm: 5000, durationDays: 14,
  exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250,
  sourceTest: { id: 't1', dimension: 'HOOK', hypothesis: 'B converts better' }, decisionId: 'd1',
  monetary: { status: 'INSUFFICIENT_EVIDENCE', reason: 'INCREMENTALITY_MONETARY_BASIS_UNPROVEN',
    knowledge: 'NOT_ENOUGH', incrementalRevenueMinor: null, currency: null },
};
vi.mock('@/hooks/useExperimentDetail.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useExperimentDetail.js')>(),
  useHoldoutDetail: () => ({ test: historical, refusal: null, reason: null, isLoading: false }),
}));

describe('SC-10 — money withheld without suppressing causal evidence', () => {
  it('shows insufficient-evidence copy, lift, confidence and provenance without calling a formatter', () => {
    render(<MemoryRouter><IncrementalityPanel tests={[historical]} currency="EGP"
      onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/20% incremental lift/)).toBeInTheDocument();
    expect(screen.getByText(/Medium confidence/)).toBeInTheDocument();
    expect(screen.getByText(/From A\/B test · HOOK/)).toBeInTheDocument();
    expect(screen.getByText(/Revenue valuation unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/500\.00|USD|EGP/)).not.toBeInTheDocument();
    expect(formatCurrency).not.toHaveBeenCalled();
  });
  it('detail keeps counts, CI, confidence, source and decision linkage with money withheld', () => {
    const { container } = render(<MemoryRouter><HoldoutDetailView /></MemoryRouter>);
    expect(container.textContent).toContain('5,000');
    expect(container.textContent).toContain('300');
    expect(container.textContent).toContain('250');
    expect(container.textContent).toContain('20%');
    expect(container.textContent).toContain('interval 0.001% to 0.018%');
    expect(container.textContent).toContain('Medium confidence');
    expect(screen.getByRole('link', { name: /Promoted from/ })).toHaveAttribute('href', '/app/testing/t1');
    expect(screen.getByRole('link', { name: /Read the decision/ })).toHaveAttribute('href', '/app/decisions/d1');
    expect(container.textContent).not.toMatch(/incremental revenue|USD|EGP|500\.00/);
    expect(formatCurrency).not.toHaveBeenCalled();
  });
});
