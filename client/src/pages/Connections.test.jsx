// ============================================================
// ConnectionsView — Google Ads is a live channel (Fix 7)
// ------------------------------------------------------------
// Regression guard: Google Ads has a real OAuth route (GET /api/auth/google/
// connect) and must render a real "connect" action — NOT "coming soon". Only
// unbuilt channels (TikTok / LinkedIn / Snap) honestly show "soon".
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectionsView } from './Connections.jsx';

describe('ConnectionsView — honest channel availability', () => {
  it('Google Ads shows a real "connect" action (live), never "coming soon"', () => {
    const { getByText, getAllByText } = render(<ConnectionsView connections={[]} projectId="p1" />);
    expect(getByText('Google Ads')).toBeTruthy();
    // Meta + Google both have OAuth routes → exactly two live "connect" actions
    expect(getAllByText('connect').length).toBe(2);
  });

  it('unbuilt channels honestly show "soon" (TikTok / LinkedIn / Snap)', () => {
    const { getAllByText } = render(<ConnectionsView connections={[]} projectId="p1" />);
    expect(getAllByText('soon').length).toBe(3);
  });
});
