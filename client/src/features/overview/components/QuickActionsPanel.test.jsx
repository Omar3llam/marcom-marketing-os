// ============================================================
// QuickActionsPanel — the agentic "Run sweep" steer (operator-gated)
// ------------------------------------------------------------
// The four nav actions are unconditional; the async "Run a sweep now" action is
// added only for an operator, reflects its in-flight state, and surfaces the
// real backend error honestly.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuickActionsPanel from './QuickActionsPanel.jsx';

const renderPanel = (props) =>
  render(<MemoryRouter><QuickActionsPanel {...props} /></MemoryRouter>);

describe('QuickActionsPanel — Run sweep', () => {
  it('always renders the four navigation actions', () => {
    renderPanel({});
    expect(screen.getByRole('button', { name: /upload new csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open insights|find growth signal/i })).toBeInTheDocument();
  });

  it('shows "Run a sweep now" only for an operator, and clicking fires onRunSweep', () => {
    const onRunSweep = vi.fn();
    renderPanel({ canRunSweep: true, onRunSweep });
    const btn = screen.getByRole('button', { name: /run a sweep now/i });
    fireEvent.click(btn);
    expect(onRunSweep).toHaveBeenCalledTimes(1);
  });

  it('hides the sweep action for a non-operator (canRunSweep=false)', () => {
    renderPanel({ canRunSweep: false, onRunSweep: vi.fn() });
    expect(screen.queryByRole('button', { name: /run a sweep now/i })).not.toBeInTheDocument();
  });

  it('reflects the in-flight sweep (disabled + Sweeping…)', () => {
    renderPanel({ canRunSweep: true, onRunSweep: vi.fn(), sweepBusy: true });
    const btn = screen.getByRole('button', { name: /sweeping/i });
    expect(btn).toBeDisabled();
  });

  it('surfaces the real sweep error, not a generic message', () => {
    renderPanel({ canRunSweep: true, onRunSweep: vi.fn(), sweepError: new Error('No resolvable workspace.') });
    expect(screen.getByText(/No resolvable workspace/i)).toBeInTheDocument();
  });
});
