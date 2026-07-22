// ============================================================
// Landing — verdict-first (v1.0 decision-first, polish pass)
// ------------------------------------------------------------
// useReveal is mocked (no IntersectionObserver in jsdom) so the reveal-gated
// sections render shown. Hero uses <Link>, so it renders under a MemoryRouter.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./useReveal.js', () => ({ useReveal: () => [{ current: null }, true] }));

import { Hero } from './HeroSection.jsx';
import { SignalToAction } from './SignalToActionSection.jsx';
import { CapabilitiesGrid } from './FeaturesSection.jsx';
import { WhyLumiDecides } from './WhyKillSection.jsx';

const renderHero = () => render(<MemoryRouter><Hero /></MemoryRouter>);

describe('Landing Hero — verdict-first rewrite', () => {
  it('leads with the headline + a subheadline that says what Lumi is', () => {
    renderHero();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/Know what to/i);
    expect(h1).toHaveTextContent(/every sync/i);
    expect(screen.getByText(/analyzes every Meta and Google campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/tells you exactly what to kill, scale, refresh, or watch/i)).toBeInTheDocument();
    expect(screen.queryByText(/never sleeps/i)).not.toBeInTheDocument();
  });

  it('shows the trust strip below the subheadline', () => {
    renderHero();
    expect(screen.getByText(/Just decisions backed by your data/i)).toBeInTheDocument();
  });

  it('primary CTA "Connect Meta → Get my first verdict" → /signup; secondary "See how Lumi decides" → #why', () => {
    renderHero();
    expect(screen.getByRole('link', { name: /Get my first verdict/i })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: /See how Lumi decides/i })).toHaveAttribute('href', '#why');
  });

  it('renders an enriched Verdict card (labelled decision, not a metric dump)', () => {
    renderHero();
    expect(screen.getByText(/Lumi — Campaign Analysis/i)).toBeInTheDocument();
    expect(screen.getByText('Alexandria Villas — July')).toBeInTheDocument();
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText(/Primary reason/i)).toBeInTheDocument();
    expect(screen.getByText(/below average/i)).toBeInTheDocument();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText('Pause today.')).toBeInTheDocument();
    expect(screen.getByText('Launch a new creative angle.')).toBeInTheDocument();
    // the old chat + health-score framing must be gone
    expect(screen.queryByText(/Ask Lumi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ask about your campaigns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Account Health/i)).not.toBeInTheDocument();
  });

  it('never positions Lumi as "AI-powered" or a "platform"', () => {
    const { container } = renderHero();
    expect(container.textContent).not.toMatch(/AI-powered/i);
    expect(container.textContent).not.toMatch(/platform/i);
  });
});

describe('Landing — "From signal to action" loop', () => {
  it('renders the outcome loop with all five nodes', () => {
    render(<SignalToAction />);
    expect(screen.getByRole('heading', { name: /From signal to action/i })).toBeInTheDocument();
    for (const node of ['Campaign synced', 'Lumi detects weak signals', 'Verdict', 'Recommended action', 'Performance improves']) {
      expect(screen.getByText(node)).toBeInTheDocument();
    }
  });
});

describe('Landing — "Every campaign gets a verdict" workflow', () => {
  it('replaces the old headline and renders the 6-step workflow', () => {
    render(<CapabilitiesGrid />);
    expect(screen.getByText(/Every campaign gets a verdict/i)).toBeInTheDocument();
    expect(screen.queryByText(/scored every sync/i)).not.toBeInTheDocument();
    for (const step of ['Connect', 'Collect Signals', 'Score', 'Verdict', 'Recommended Actions', 'Decision Memory']) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('the final step names the Decision Memory moat', () => {
    render(<CapabilitiesGrid />);
    expect(screen.getByText('Decision Memory')).toBeInTheDocument();
    expect(screen.getByText(/learns from every verdict/i)).toBeInTheDocument();
  });
});

describe('Landing — "Why Lumi said KILL" timeline', () => {
  it('is the #why scroll target with a paper-trail timeline + a full KILL verdict card', () => {
    const { container } = render(<WhyLumiDecides />);
    expect(container.querySelector('#why')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /Why Lumi said KILL/i })).toBeInTheDocument();
    expect(screen.getByText(/Every verdict has a paper trail/i)).toBeInTheDocument();
    // timeline narrative: healthy start → confirmed decline
    expect(screen.getByText('CTR at 1.8%')).toBeInTheDocument();
    expect(screen.getByText(/12 days of decline/i)).toBeInTheDocument();
    // the payoff verdict card
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText('Pause today.')).toBeInTheDocument();
    expect(screen.getByText(/Frequency reached 7.1/i)).toBeInTheDocument();
  });
});
