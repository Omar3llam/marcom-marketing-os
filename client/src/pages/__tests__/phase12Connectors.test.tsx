// ============================================================
// Phase 12 — Connector surfacing (staleness honesty + connections)
// ------------------------------------------------------------
// Pure-component assertions (no network): the Blended Truth panel renders the
// stale-channel honesty banner; the Connections view reflects connected / stale /
// not-connected states; the connections payload validates against its schema.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoleContext } from '@/context/RoleContext.jsx';
import { BlendedTruthView } from '@/pages/BlendedTruth.jsx';
import { ConnectionsView } from '@/features/connectors/ConnectorsView.jsx';
import { ConnectionsResponseSchema, BlendedTruthSchema } from '@/contracts/schemas';

function withRole(role: string) {
  // MemoryRouter so deep-linking components (BlendedTruthView channel links) have
  // a Router context.
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
      <RoleContext.Provider value={{ role, visibleStates: null, loading: false, error: null }}>{children}</RoleContext.Provider>
    </MemoryRouter>
  );
}

const channel = (over = {}) => ({
  channelId: 'a', channel: 'META', currency: 'USD', spendMinor: 100000, platformRevenueMinor: 420000,
  actualRevenueMinor: 210000, blendedRevenueMinor: 210000, gapMinor: 210000, gapPct: 50,
  platformRoas: 4.2, blendedRoas: 2.1, coverage: 'RECONCILED', confidence: 'HIGH', ...over,
});

describe('Blended Truth — staleness honesty banner (Phase 12)', () => {
  it('renders the stale banner when a tracked channel is stale', () => {
    const data = {
      channels: [channel({ channel: 'META', stale: false }), channel({ channelId: 'b', channel: 'GOOGLE', stale: true })],
      portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 50, platformRoas: 4.2, blendedRoas: 2.1, reconciledCount: 1, unverifiedCount: 1, hasStale: true },
    };
    render(<BlendedTruthView data={data} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.getByText(/GOOGLE data is stale/i)).toBeInTheDocument();
  });
  it('no banner when all tracked channels are fresh', () => {
    const data = {
      channels: [channel({ stale: false }), channel({ channelId: 'b', channel: 'GOOGLE', stale: false })],
      portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 50, platformRoas: 4.2, blendedRoas: 2.1, reconciledCount: 2, unverifiedCount: 0, hasStale: false },
    };
    render(<BlendedTruthView data={data} role="STRATEGIST" />, { wrapper: withRole('STRATEGIST') });
    expect(screen.queryByText(/data is stale/i)).not.toBeInTheDocument();
  });
});

describe('Connections view', () => {
  it('shows connected/stale/not-connected per channel', () => {
    render(<ConnectionsView connections={[
      { platform: 'META', isActive: true, connected: true, stale: false, readiness: 'CURRENT', availability: 'OK', completeness: 'COMPLETE', lastSuccessfulSync: new Date().toISOString(), accountId: 'act_1', health: null },
      { platform: 'GOOGLE', isActive: true, connected: true, stale: true, readiness: 'STALE', availability: 'FAILING', completeness: 'COMPLETE', lastSuccessfulSync: new Date(Date.now() - 3 * 86400000).toISOString(), accountId: 'cust_1', health: { lastError: 'token expired' } },
    ]} />);
    expect(screen.getByText('Meta Ads')).toBeInTheDocument();
    expect(screen.getByText(/Stale · Last successful sync 3d ago/)).toBeInTheDocument();
    expect(screen.getByText(/Latest sync attempt failed/)).toBeInTheDocument();
    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
    expect(screen.getByText(/token expired/i)).toBeInTheDocument();
    // OAuth-unsupported channels (TikTok/LinkedIn/Snap) show "soon", not "connect".
    expect(screen.getAllByText('soon').length).toBeGreaterThan(0);
  });
  it('a not-connected Google row offers a "connect" affordance', () => {
    render(<ConnectionsView connections={[{ platform: 'META', isActive: true, connected: true, stale: false, lastSyncedAt: new Date().toISOString() }]} />);
    // Google is absent from the list → not connected → a connect button (OAuth-supported).
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.getAllByText('connect').length).toBeGreaterThan(0);
  });
});

describe('contract seam', () => {
  it('connections + blended-truth (with stale fields) validate', () => {
    expect(ConnectionsResponseSchema.safeParse({ workspaceId: 'w', connections: [{ platform: 'META', isActive: true, connected: true, stale: false }] }).success).toBe(true);
    expect(BlendedTruthSchema.safeParse({ channels: [channel({ stale: true, lastSyncedAt: null })], portfolio: { spendMinor: 0, platformRevenueMinor: 0, blendedRevenueMinor: 0, gapMinor: 0, gapPct: 0, platformRoas: 0, blendedRoas: 0, reconciledCount: 0, unverifiedCount: 0, hasStale: true } }).success).toBe(true);
  });
});
