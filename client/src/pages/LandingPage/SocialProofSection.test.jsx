// ============================================================
// SocialProofSection (TrustedBy) — honest early-access, no fake personas
// ------------------------------------------------------------
// useReveal mocked (no IntersectionObserver in jsdom); MemoryRouter for <Link>.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./useReveal.js', () => ({ useReveal: () => [{ current: null }, true] }));
import { TrustedBy } from './SocialProofSection.jsx';

describe('TrustedBy — honest social proof', () => {
  it('shows real product facts and a working early-access CTA', () => {
    render(<MemoryRouter><TrustedBy /></MemoryRouter>);
    expect(screen.getByText(/Never shared/i)).toBeInTheDocument();
    expect(screen.getByText(/under 2 minutes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request early access/i })).toHaveAttribute('href', '/signup');
  });

  it('no longer renders the old fabricated personas', () => {
    render(<MemoryRouter><TrustedBy /></MemoryRouter>);
    expect(screen.queryByText(/Apparel teams/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beauty operators/i)).not.toBeInTheDocument();
  });
});
