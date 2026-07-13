// ============================================================
// LeadershipView — empty-state generate CTA (Fix 6)
// ------------------------------------------------------------
// With no reports, a STRATEGIST gets a one-click CTA that REUSES the existing
// generate handler, plus an honest note about the automatic Monday cadence. A
// non-author (CLIENT/BUYER) never sees a generate CTA.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// vi.mock is hoisted above these lines — use vi.hoisted so the factory can
// reference `generate`, and inline WORKSPACE_ROLE inside the factory (no TDZ).
const { generate } = vi.hoisted(() => ({ generate: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(() => ({ role: 'STRATEGIST' })),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
vi.mock('@/hooks/useNarratives.js', () => ({
  useNarratives: vi.fn(() => ({
    narratives: [], isLoading: false, error: null, isRestricted: false,
    generate, isGenerating: false, getNarrative: vi.fn(), refetch: vi.fn(),
  })),
}));

import { LeadershipView } from './LeadershipView.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';

function renderView() {
  return render(<MemoryRouter><LeadershipView /></MemoryRouter>);
}

afterEach(() => {
  useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
  generate.mockClear();
});

describe('LeadershipView — empty-state generate CTA', () => {
  it('STRATEGIST with no reports → shows the CTA + the auto-cadence note', () => {
    const { getByText } = renderView();
    expect(getByText(/generate this week/i)).toBeTruthy();
    expect(getByText(/automatically every Monday/i)).toBeTruthy();
  });

  it('clicking the CTA reuses the existing generate handler (weekly leadership)', () => {
    const { getByText } = renderView();
    fireEvent.click(getByText(/generate this week/i));
    expect(generate).toHaveBeenCalledWith({ period: 'WEEKLY', audience: 'LEADERSHIP' });
  });

  it('CLIENT with no reports → no generate CTA (cannot author)', () => {
    useCollabRole.mockReturnValue({ role: 'CLIENT' });
    const { queryByText, getByText } = renderView();
    expect(queryByText(/generate this week/i)).toBeNull();
    expect(getByText(/No leadership reports available yet/i)).toBeTruthy();
  });
});
