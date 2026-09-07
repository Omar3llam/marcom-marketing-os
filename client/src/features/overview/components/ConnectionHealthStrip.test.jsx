// ============================================================
// ConnectionHealthStrip — actionable when no channel is connected
// ------------------------------------------------------------
// The Home strip is honest status first, but when NOTHING is connected it must
// also be a way out — a "Connect →" link to the Channels page. When a channel is
// connected it stays read-only (connecting/reconnecting lives on Channels). Every
// value still traces to a real Integration row (GET /api/lumi/connections).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));

import ConnectionHealthStrip from './ConnectionHealthStrip.jsx';
import { useConnections } from '@/hooks/useConnections.js';

const renderStrip = () => render(<MemoryRouter><ConnectionHealthStrip /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('ConnectionHealthStrip — Connect affordance', () => {
  it('no channel connected → shows a "Connect →" link to the Channels page', () => {
    useConnections.mockReturnValue({
      data: { connections: [{ platform: 'META', connected: false }, { platform: 'GOOGLE', connected: false }] },
      loading: false, error: null,
    });
    renderStrip();
    const link = screen.getByRole('link', { name: /Connect/i });
    expect(link).toHaveAttribute('href', '/app/connections');
  });

  it('a channel is connected → read-only, no Connect link', () => {
    useConnections.mockReturnValue({
      data: { connections: [{ platform: 'META', connected: true, lastSyncedAt: new Date().toISOString() }] },
      loading: false, error: null,
    });
    renderStrip();
    expect(screen.queryByRole('link', { name: /Connect/i })).not.toBeInTheDocument();
  });

  it('loading and error states never render a Connect link (nothing to act on yet)', () => {
    useConnections.mockReturnValue({ data: null, loading: true, error: null });
    const { rerender } = renderStrip();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    useConnections.mockReturnValue({ data: null, loading: false, error: new Error('boom') });
    rerender(<MemoryRouter><ConnectionHealthStrip /></MemoryRouter>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
