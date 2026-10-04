// ============================================================
// ConnectionHealthStrip — the rail variant
// ------------------------------------------------------------
// Same contract, same three states, 280px wide. The rail exists because a
// channel that stopped flowing is usually WHY the decisions above look wrong,
// so it must never go quiet — not while loading, and not on error.
//
// The full-width variant's behaviour is pinned in ConnectionHealthStrip.test.jsx;
// this file only covers what `compact` changes.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));

import ConnectionHealthStrip from './ConnectionHealthStrip.jsx';
import { useConnections } from '@/hooks/useConnections.js';

const rail = () => render(<MemoryRouter><ConnectionHealthStrip compact /></MemoryRouter>);
const full = () => render(<MemoryRouter><ConnectionHealthStrip /></MemoryRouter>);
const ok = (connections) => useConnections.mockReturnValue({ data: { connections }, loading: false, error: null });

beforeEach(() => vi.clearAllMocks());

describe('per-channel status', () => {
  it('renders one line per channel with its real sync time', () => {
    ok([{ platform: 'META', connected: true, stale: false, readiness: 'CURRENT', availability: 'OK', completeness: 'COMPLETE', lastSuccessfulSync: new Date(Date.now() - 30 * 60_000).toISOString() }]);
    rail();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.getByText(/Current · Last successful sync 30m ago/)).toBeInTheDocument();
  });

  it('a never-connected channel says so, it does not go blank', () => {
    ok([]);
    rail();
    expect(screen.getAllByText('Not connected')).toHaveLength(2); // Meta + Google
  });

  it('a stale channel is called stale, not synced', () => {
    ok([{ platform: 'META', connected: true, stale: true, readiness: 'STALE', availability: 'OK', completeness: 'COMPLETE', lastSuccessfulSync: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);
    rail();
    expect(screen.getByText(/Stale · Last successful sync 3d ago/)).toBeInTheDocument();
    expect(screen.queryByText(/^Synced/)).not.toBeInTheDocument();
  });

  it('offers a way out when nothing is connected at all', () => {
    ok([]);
    rail();
    expect(screen.getByRole('link', { name: /Connect/ })).toHaveAttribute('href', '/app/connections');
  });

  it('drops the Connect link once a channel is live', () => {
    ok([{ platform: 'META', connected: true, stale: false, lastSyncedAt: new Date().toISOString() }]);
    rail();
    expect(screen.queryByRole('link', { name: /Connect/ })).not.toBeInTheDocument();
  });
});

describe('never goes quiet', () => {
  it('shows a skeleton while loading', () => {
    useConnections.mockReturnValue({ data: null, loading: true, error: null });
    const { container } = rail();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('says the read failed rather than rendering an empty rail', () => {
    useConnections.mockReturnValue({ data: null, loading: false, error: new Error('boom') });
    rail();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load channel status/)).toBeInTheDocument();
  });
});

describe('the full-width variant keeps its layout and shares semantic copy', () => {
  it('still renders its own layout, not the rail one', () => {
    ok([{ platform: 'META', connected: true, stale: false, readiness: 'CURRENT', availability: 'OK', completeness: 'COMPLETE', lastSuccessfulSync: new Date().toISOString() }]);
    const { container } = full();
    // Full variant keeps the bordered row and explicit successful event copy.
    expect(container.querySelector('.rounded-xl')).toBeTruthy();
    expect(screen.getByText(/Current · Last successful sync/)).toBeInTheDocument();
    expect(screen.queryByText(/^Synced/)).not.toBeInTheDocument();
  });
});
