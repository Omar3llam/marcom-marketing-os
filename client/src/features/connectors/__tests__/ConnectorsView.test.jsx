// ============================================================
// ConnectionsView — Google Ads is a live channel (Fix 7)
// ------------------------------------------------------------
// Regression guard: Google Ads has a real OAuth route (GET /api/auth/google/
// connect) and must render a real "connect" action — NOT "coming soon". Only
// unbuilt channels (TikTok / LinkedIn / Snap) honestly show "soon".
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectionsView } from '../ConnectorsView.jsx';

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

// ============================================================
// C-04 — the axes reach a human, and the contract stops eating one
// ============================================================
import { ConnectionsResponseSchema } from '@/contracts/schemas';

const conn = (over = {}) => ({
  platform: 'META', isActive: true, connected: true, stale: false,
  lastSyncedAt: new Date().toISOString(), accountId: 'act_1', availableAccounts: [],
  health: null, connection: 'CONNECTED', availability: 'OK',
  completeness: 'COMPLETE', readiness: 'CURRENT', capabilities: [], ...over,
});

// ── D-1 · the defect lived HERE, not in the component ───────────────────────
// The server has written and published `lastWarning` since connector health
// existed. This schema did not declare it, and `z.object` strips what it does
// not declare — so no component could render it however it was written.
describe('C-04 · the contract no longer eats lastWarning', () => {
  it('lastWarning survives safeParse', () => {
    const parsed = ConnectionsResponseSchema.safeParse({
      workspaceId: 'ws-1',
      connections: [conn({
        health: { platform: 'META', lastWarning: 'Large account: some ad sets were not read.', lastError: null },
        completeness: 'INCOMPLETE',
      })],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data.connections[0].health.lastWarning).toMatch(/ad sets were not read/);
  });

  it('the five axes survive too', () => {
    const parsed = ConnectionsResponseSchema.safeParse({
      workspaceId: 'ws-1',
      connections: [conn({
        capabilities: [{ capability: 'DAILY_OBSERVATIONS', implemented: true, lastRun: 'NO_DATA' }],
      })],
    });

    expect(parsed.success).toBe(true);
    const c = parsed.data.connections[0];
    expect([c.connection, c.availability, c.completeness, c.readiness])
      .toEqual(['CONNECTED', 'OK', 'COMPLETE', 'CURRENT']);
    expect(c.capabilities[0].lastRun).toBe('NO_DATA');
  });

  // Additive, never a gate. A contract-validation failure renders as "we could
  // not load your channels" — a worse lie than an unfamiliar word — so a server
  // that has not deployed the projection must still validate.
  it('a payload without any of the new fields still validates', () => {
    const parsed = ConnectionsResponseSchema.safeParse({
      workspaceId: 'ws-1',
      connections: [{ platform: 'META', isActive: true, connected: true, stale: false }],
    });
    expect(parsed.success).toBe(true);
  });

  // And an unfamiliar state is carried, not rejected. The day the server learns
  // a sixth one, the page keeps loading.
  it('an unknown axis value does not fail the contract', () => {
    const parsed = ConnectionsResponseSchema.safeParse({
      workspaceId: 'ws-1',
      connections: [conn({ readiness: 'SOMETHING_NEW' })],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('C-04 · what the page says', () => {
  it('never-synced reads "never synced", not "stale"', () => {
    const { container } = render(
      <ConnectionsView connections={[conn({ readiness: 'NEVER_SYNCED', stale: true })]} projectId="p1" />,
    );
    expect(container.textContent).toContain('Never synced');
    expect(container.textContent).not.toContain('stale — reconnect');
  });

  it('an aged connection still reads "stale"', () => {
    const { container } = render(
      <ConnectionsView connections={[conn({ readiness: 'STALE', stale: true })]} projectId="p1" />,
    );
    expect(container.textContent).toContain('Stale');
    expect(container.textContent).not.toMatch(/reconnect/i);
    expect(container.textContent).not.toContain('never synced');
  });

  // The axis the account owner was the one person not shown.
  it('a successful-but-short sync says so, in the owner\'s own view', () => {
    const { container } = render(
      <ConnectionsView
        connections={[conn({
          completeness: 'INCOMPLETE',
          health: { lastWarning: 'some ad sets were not read', lastError: null },
        })]}
        projectId="p1"
      />,
    );
    expect(container.textContent).toContain('incomplete');
    expect(container.textContent).toContain('some ad sets were not read');
  });

  // Both are true and neither explains the other, so both are stated.
  it('states incompleteness BESIDE an error, never instead of it', () => {
    const { container } = render(
      <ConnectionsView
        connections={[conn({
          availability: 'FAILING', completeness: 'INCOMPLETE',
          health: { lastWarning: 'short read', lastError: 'rate limited' },
        })]}
        projectId="p1"
      />,
    );
    expect(container.textContent).toContain('short read');
    expect(container.textContent).toContain('rate limited');
  });

  // A legacy payload validates, but its boolean is not readiness authority.
  it('keeps freshness unavailable when no readiness is published', () => {
    const { container } = render(
      <ConnectionsView connections={[conn({ readiness: undefined, stale: true })]} projectId="p1" />,
    );
    expect(container.textContent).toContain('Freshness unavailable');
    expect(container.textContent).not.toMatch(/Stale|reconnect/);
  });
});
