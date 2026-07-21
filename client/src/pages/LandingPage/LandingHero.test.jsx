// ============================================================
// Landing — verdict-first hero rewrite
// ------------------------------------------------------------
// useReveal is mocked (no IntersectionObserver in jsdom) so the reveal-gated
// sections render shown. Hero uses <Link>, so it renders under a MemoryRouter.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./useReveal.js', () => ({ useReveal: () => [{ current: null }, true] }));

import { Hero } from './HeroSection.jsx';
import { CapabilitiesGrid } from './FeaturesSection.jsx';
import { WhyLumiDecides } from './WhyKillSection.jsx';

const renderHero = () => render(<MemoryRouter><Hero /></MemoryRouter>);

describe('Landing Hero — verdict-first rewrite', () => {
  it('leads with the new headline + subheadline (old "never sleeps" gone)', () => {
    renderHero();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/Know what to/i);
    expect(h1).toHaveTextContent(/Every sync/i);
    expect(screen.getByText(/tells you exactly what to scale, kill, refresh, or watch/i)).toBeInTheDocument();
    expect(screen.queryByText(/never sleeps/i)).not.toBeInTheDocument();
  });

  it('shows the trust strip below the subheadline', () => {
    renderHero();
    expect(screen.getByText(/Just decisions backed by your campaign data/i)).toBeInTheDocument();
  });

  it('primary CTA "Get my first verdict" → /signup; secondary "See how Lumi decides" → #why', () => {
    renderHero();
    expect(screen.getByRole('link', { name: /Get my first verdict/i })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: /See how Lumi decides/i })).toHaveAttribute('href', '#why');
  });

  it('renders a Verdict card (the Copilot chat is gone)', () => {
    renderHero();
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText('Alexandria Leads')).toBeInTheDocument();
    expect(screen.getByText(/Account Health/i)).toBeInTheDocument();
    expect(screen.getByText('44/100')).toBeInTheDocument();
    expect(screen.getByText(/CONFIDENCE 94%/i)).toBeInTheDocument();
    expect(screen.getByText('Pause today.')).toBeInTheDocument();
    // the old chat affordances must be gone
    expect(screen.queryByText(/Ask Lumi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ask about your campaigns/i)).not.toBeInTheDocument();
  });

  it('never positions Lumi as "AI-powered" or a "platform"', () => {
    const { container } = renderHero();
    expect(container.textContent).not.toMatch(/AI-powered/i);
    expect(container.textContent).not.toMatch(/platform/i);
  });
});

describe('Landing — "Every campaign gets a verdict" workflow', () => {
  it('replaces the old headline and renders the 5-step workflow', () => {
    render(<CapabilitiesGrid />);
    expect(screen.getByText(/Every campaign gets a verdict/i)).toBeInTheDocument();
    expect(screen.queryByText(/scored every sync/i)).not.toBeInTheDocument();
    for (const step of ['Connect', 'Analyze', 'Verdict', 'Optimize', 'Remember']) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('the "Remember" step names the Decision Memory moat', () => {
    render(<CapabilitiesGrid />);
    expect(screen.getByText(/Decision Memory learns from every call/i)).toBeInTheDocument();
  });
});

describe('Landing — "Why Lumi said KILL"', () => {
  it('is the #why scroll target with evidence + a KILL verdict', () => {
    const { container } = render(<WhyLumiDecides />);
    expect(container.querySelector('#why')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Why Lumi said KILL/i })).toBeInTheDocument();
    expect(screen.getByText(/Every verdict comes with evidence/i)).toBeInTheDocument();
    expect(screen.getByText('CTR fell 42%')).toBeInTheDocument();
    expect(screen.getByText(/No recovery in 12 days/i)).toBeInTheDocument();
    expect(screen.getByText('KILL')).toBeInTheDocument();
  });
});
