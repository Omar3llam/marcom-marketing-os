// ============================================================
// FirstRunBanner — pure render + callback wiring
// ------------------------------------------------------------
// The banner itself is dumb: OverviewView owns the show/retire logic (tested
// there). These pin what the banner renders (title, description, a CTA linking
// to the real destination) and that both the dismiss X and the CTA fire their
// callbacks — the CTA's callback is how OverviewView retires the firstActivation
// flag when the user acts on it.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FirstRunBanner from './FirstRunBanner.jsx';

const base = {
  title: 'Connect a channel to get started',
  description: 'Lumi needs your live campaign data.',
  primaryAction: { label: 'Connect a channel', href: '/app/settings/integrations' },
};

const renderBanner = (props = {}) =>
  render(<MemoryRouter><FirstRunBanner {...base} {...props} /></MemoryRouter>);

describe('FirstRunBanner', () => {
  it('renders the title, description, and a CTA linking to the destination', () => {
    renderBanner();
    expect(screen.getByText('Connect a channel to get started')).toBeInTheDocument();
    expect(screen.getByText(/Lumi needs your live campaign data/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Connect a channel/i });
    expect(cta).toHaveAttribute('href', '/app/settings/integrations');
  });

  it('clicking the CTA fires onCtaClick (how OverviewView retires the flag)', () => {
    const onCtaClick = vi.fn();
    renderBanner({ onCtaClick });
    fireEvent.click(screen.getByRole('link', { name: /Connect a channel/i }));
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });

  it('clicking dismiss fires onDismiss; no dismiss button when onDismiss is absent', () => {
    const onDismiss = vi.fn();
    const { rerender } = renderBanner({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<MemoryRouter><FirstRunBanner {...base} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
