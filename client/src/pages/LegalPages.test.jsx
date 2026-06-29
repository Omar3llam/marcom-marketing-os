// ============================================================
// Privacy + Terms — public static pages render with their key promises
// ------------------------------------------------------------
// MemoryRouter for the "Back to home" <Link>.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage.jsx';
import TermsPage from './TermsPage.jsx';

describe('Legal pages', () => {
  it('Privacy renders its heading + the no-sell promise', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/never sell your data/i)).toBeInTheDocument();
  });

  it('Terms renders its heading + acceptable-use section', () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /acceptable use/i })).toBeInTheDocument();
  });
});
