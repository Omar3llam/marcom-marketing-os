// ============================================================
// B8-03 — the THEN destination is REACHED, not merely built
// ------------------------------------------------------------
// The backend read is proven on real rows; the schema is proven at the parse
// boundary. Neither proves an operator can see a decision. The B7 consumer
// sweep found three closed contracts whose fields no surface read, and every
// gate that proved they LANDED passed — so this file exists to close the fourth
// step of the gate for this slice: RENDERED.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useDecisionHistory = vi.fn();
vi.mock('@/hooks/useDecisionHistory.js', () => ({ useDecisionHistory: () => useDecisionHistory() }));

const DecisionHistoryView = (await import('./DecisionHistoryView.jsx')).default;

const renderView = () => render(<MemoryRouter><DecisionHistoryView /></MemoryRouter>);

const signal = {
  id: 'd1', decisionClass: 'SIGNAL', entityId: 'c1', entityLevel: 'CAMPAIGN',
  verdict: 'KILL', status: 'SUPERSEDED', diagnosis: 'ROAS below floor for 14 days',
  rootCause: null, confidence: 0.82, createdAt: new Date('2026-09-01T00:00:00Z'),
};
const guardrail = {
  ...signal, id: 'd2', decisionClass: 'GUARDRAIL', status: 'RESOLVED',
  diagnosis: 'Spend ceiling breached', confidence: 0.9,
};

const state = (over = {}) => ({
  decisions: [], total: 0, hasMore: false, isLoading: false,
  error: null, loadMore: vi.fn(), refetch: vi.fn(), ...over,
});

beforeEach(() => { useDecisionHistory.mockReset(); });

describe('B8-03 · the destination shows what Lumi decided', () => {
  it('renders a decision, its verdict, its class and its outcome', () => {
    useDecisionHistory.mockReturnValue(state({ decisions: [signal], total: 1 }));
    renderView();
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText(/ROAS below floor/)).toBeInTheDocument();
    expect(screen.getByText('Signal')).toBeInTheDocument();
    // A closed decision states HOW it closed — THEN is historical commitment.
    expect(screen.getByText(/Replaced by a later call/)).toBeInTheDocument();
  });

  it('shows a confidence figure for SIGNAL, where it is a measurement', () => {
    useDecisionHistory.mockReturnValue(state({ decisions: [signal], total: 1 }));
    renderView();
    expect(screen.getByText(/82% confidence/)).toBeInTheDocument();
  });

  it('shows NO confidence figure on a GUARDRAIL row — L-4', () => {
    // The column is called `confidence` for every writer, but only Signal
    // DERIVES it. A guardrail's 0.9 is a constant, and rendering it as a
    // percentage is a constant dressed as a measurement.
    useDecisionHistory.mockReturnValue(state({ decisions: [guardrail], total: 1 }));
    renderView();
    expect(screen.getByText('Guardrail')).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/90%/)).not.toBeInTheDocument();
  });
});

describe('B8-03 · absence names its cause', () => {
  it('a FAILED read says so, and does not claim the history is empty', () => {
    useDecisionHistory.mockReturnValue(state({ error: new Error('500') }));
    renderView();
    expect(screen.getByText(/couldn’t read this history/i)).toBeInTheDocument();
    expect(screen.queryByText(/hasn’t decided anything/i)).not.toBeInTheDocument();
  });

  it('a genuinely EMPTY history reads as empty, with no error copy', () => {
    // Non-vacuity: failure ≠ empty has to hold in both directions.
    useDecisionHistory.mockReturnValue(state());
    renderView();
    expect(screen.getByText(/hasn’t decided anything/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t read/i)).not.toBeInTheDocument();
  });

  it('does not render an empty state while the first page is loading', () => {
    useDecisionHistory.mockReturnValue(state({ isLoading: true }));
    renderView();
    expect(screen.queryByText(/hasn’t decided anything/i)).not.toBeInTheDocument();
  });
});

describe('B8-03 · a capped list is not a capped count', () => {
  it('states the page size AND the total, so neither implies the other', () => {
    useDecisionHistory.mockReturnValue(state({ decisions: [signal, guardrail], total: 137 }));
    renderView();
    expect(screen.getByText(/Showing 2 of 137/)).toBeInTheDocument();
  });

  it('offers more only when there IS more', () => {
    useDecisionHistory.mockReturnValue(state({ decisions: [signal], total: 1, hasMore: false }));
    const { unmount } = renderView();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    unmount();

    useDecisionHistory.mockReturnValue(state({ decisions: [signal], total: 99, hasMore: true }));
    renderView();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('does not claim a total it has not established', () => {
    // `total: null` means the count did not land. Rendering "of 0" would be a
    // fabricated claim about the account.
    useDecisionHistory.mockReturnValue(state({ decisions: [signal], total: null }));
    renderView();
    expect(screen.getByText(/Showing 1$/)).toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });
});
