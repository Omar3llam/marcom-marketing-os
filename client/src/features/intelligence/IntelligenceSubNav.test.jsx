// ============================================================
// IntelligenceSubNav — role-filtered, route-driven sub-nav strip
// ------------------------------------------------------------
// Asserts: S/B see all three tabs; the active route is marked current; a CLIENT
// (who can only reach Proof) sees < 2 tabs and so the strip renders nothing
// rather than an orphan single tab.
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
  it('shows all three tabs for a STRATEGIST', () => {
    roleState = { role: 'STRATEGIST', loading: false };
    renderAt('/app/intelligence/insights');
    expect(screen.getByRole('link', { name: /blended truth/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /growth strategy/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /proof of learning/i })).toBeInTheDocument();
  });

  it('shows all three tabs for a BUYER (proof is ungated)', () => {
    roleState = { role: 'BUYER', loading: false };
    renderAt('/app/intelligence/blended-truth');
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('marks the current route as the active tab', () => {
    roleState = { role: 'STRATEGIST', loading: false };
    renderAt('/app/intelligence/proof');
    expect(screen.getByRole('link', { name: /proof of learning/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /blended truth/i })).not.toHaveAttribute('aria-current');
  });

  it('renders nothing for a CLIENT (only Proof reachable → no orphan single tab)', () => {
    roleState = { role: 'CLIENT', loading: false };
    const { container } = renderAt('/app/intelligence/proof');
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
