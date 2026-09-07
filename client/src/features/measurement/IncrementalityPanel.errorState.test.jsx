// ============================================================
// IncrementalityPanel — honest, actionable error state
// ------------------------------------------------------------
// A load failure is kept as an ERROR (not relabeled "no data"), but it now
// names the real dependency and offers a working Connect-Meta action rather
// than a dead-end red card.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IncrementalityPanel } from './IncrementalityPanel.jsx';

const renderPanel = (props) =>
  render(
    <MemoryRouter>
      <IncrementalityPanel onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} {...props} />
    </MemoryRouter>,
  );

describe('IncrementalityPanel — error state', () => {
  it('names the dependency on a load error', () => {
    renderPanel({ error: new Error('boom') });
    expect(screen.getByText(/we couldn.t load incrementality/i)).toBeInTheDocument();
    expect(screen.getByText(/needs a connected channel/i)).toBeInTheDocument();
  });

  it('offers a real Connect-Meta action to the integrations route', () => {
    renderPanel({ error: new Error('boom') });
    const link = screen.getByRole('link', { name: /connect meta/i });
    expect(link).toHaveAttribute('href', '/app/connections');
  });
});
