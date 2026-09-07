// ============================================================
// IntelligenceSubNav — role-filtered, route-driven sub-nav strip
// ------------------------------------------------------------
// REPLACES the three-tab assertions. They pinned "S/B see all three tabs" and
// "the active route is marked current" using Proof of Learning as the example,
// which was true and is now the wrong shape: FE-02 made Proof the SECOND
// READING of Memory (B7 Ruling 2 — one object, two readings), so it is a
// section at /app/memory rather than a peer of these two, and listing it here
// would give one object two destinations.
//
// The assertions are replaced rather than relaxed, so what is pinned is the
// RULING, not a tab count that happens to be two today.
//
// ⚠️ ONE TEST BELOW STILL PASSES, FOR A DIFFERENT REASON THAN ITS OLD NAME
// CLAIMED, and that is worth naming. "renders nothing for a CLIENT" used to
// hold because a CLIENT could reach exactly ONE of the three tabs and the strip
// refuses to render an orphan single tab. A CLIENT can now reach ZERO of the
// two, so the same expectation passes off a different fact. Left green with the
// cause restated — a green test whose reason has silently moved is exactly the
// species this slice deleted elsewhere.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import IntelligenceSubNav from './IntelligenceSubNav.jsx';

let roleState = { role: 'STRATEGIST', loading: false };
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => roleState,
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

const renderAt = (path) =>
  render(<MemoryRouter initialEntries={[path]}><IntelligenceSubNav /></MemoryRouter>);

describe('IntelligenceSubNav', () => {
  it('shows the two Intelligence surfaces for a STRATEGIST', () => {
    roleState = { role: 'STRATEGIST', loading: false };
    renderAt('/app/intelligence/insights');
    expect(screen.getByRole('link', { name: /blended truth/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /growth strategy/i })).toBeInTheDocument();
  });

  it('does NOT offer Proof of Learning — it is Memory\'s second reading now', () => {
    roleState = { role: 'STRATEGIST', loading: false };
    renderAt('/app/intelligence/insights');
    expect(screen.queryByRole('link', { name: /proof of learning/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows the same two for a BUYER', () => {
    roleState = { role: 'BUYER', loading: false };
    renderAt('/app/intelligence/blended-truth');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('marks the current route as the active tab', () => {
    roleState = { role: 'STRATEGIST', loading: false };
    renderAt('/app/intelligence/insights');
    expect(screen.getByRole('link', { name: /growth strategy/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /blended truth/i })).not.toHaveAttribute('aria-current');
  });

  it('renders nothing for a CLIENT — who can now reach neither surface', () => {
    // Not "one tab is an orphan" any more: a CLIENT is excluded from BOTH
    // remaining sections, so there is nothing to navigate between at all. The
    // reading a CLIENT is entitled to (Proof) is reached at /app/memory.
    roleState = { role: 'CLIENT', loading: false };
    const { container } = renderAt('/app/intelligence/insights');
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
