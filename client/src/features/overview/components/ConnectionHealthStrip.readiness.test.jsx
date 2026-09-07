// ============================================================
// ConnectionHealthStrip — a channel that never synced is not "stale"
// ------------------------------------------------------------
// FE-04. `isStale(lastSuccessfulSync)` returns TRUE for null
// (connectorTypes.js:117), which is correct for the question IT answers — "is
// there fresh data?" — and wrong as a WORD. A channel connected five minutes
// ago and not yet synced arrives on the wire as
//
//     { connected: true, stale: true, lastSyncedAt: null, readiness: 'NEVER_SYNCED' }
//
// and this strip rendered `Stale · ${ago(null)}` → "Stale · never". Stale
// claims we had data and it aged. Never says nothing ever arrived. One line,
// one channel, both words.
//
// C-04 published the three-state `readiness` for exactly this distinction and
// the Channels page has read it since. This reader never adopted it, so the
// same channel read "Stale · never" on Attention and "never synced" on
// Channels — one object, two readings, and the honest one was the buried one.
//
// This is a PUBLISHED → PARSED → *RENDERED* failure. C-04's contract is not
// touched here and neither is isStale(): the fix is one consumer coming into
// compliance with a field it already receives.
//
// Every pre-existing fixture in this component's two test files supplies
// `stale` and `lastSyncedAt` TOGETHER, which is why the state was unpinned.
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

// The shape credentialStore.listConnections produces for a row that has
// connected but never completed a sync: is_active true, last_synced_at NULL,
// health NULL. Not hypothetical — it is every channel's first minutes.
const NEVER_SYNCED = {
  platform: 'META', connected: true, stale: true, lastSyncedAt: null, readiness: 'NEVER_SYNCED',
};

beforeEach(() => vi.clearAllMocks());

describe('FE-04 · a never-synced channel is never called stale', () => {
  it('the rail says it has never synced, and does not say "stale"', () => {
    ok([NEVER_SYNCED]);
    const { container } = rail();
    expect(container.textContent).toMatch(/never synced/i);
    expect(container.textContent).not.toMatch(/stale/i);
  });

  it('the rail never renders the self-contradiction "Stale · never"', () => {
    ok([NEVER_SYNCED]);
    const { container } = rail();
    expect(container.textContent).not.toMatch(/Stale\s*·\s*never/i);
  });

  it('the full-width variant makes the same distinction', () => {
    ok([NEVER_SYNCED]);
    const { container } = full();
    expect(container.textContent).toMatch(/never synced/i);
    expect(container.textContent).not.toMatch(/stale/i);
  });

  // Self-refutation for the three assertions above: they must be failing to
  // find "stale" because the word was replaced for THIS state, not because the
  // strip stopped saying it at all.
  it('an aged connection is still called stale — the word is not gone', () => {
    ok([{ platform: 'META', connected: true, stale: true, readiness: 'STALE',
          lastSyncedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);
    const { container } = rail();
    expect(container.textContent).toMatch(/Stale · 3d ago/);
    expect(container.textContent).not.toMatch(/never synced/i);
  });

  it('a current connection is untouched', () => {
    ok([{ platform: 'META', connected: true, stale: false, readiness: 'CURRENT',
          lastSyncedAt: new Date(Date.now() - 30 * 60_000).toISOString() }]);
    expect(rail().container.textContent).toMatch(/Synced 30m ago/);
  });

  // A server that predates C-04 publishes no `readiness` at all. The two fields
  // it DOES publish still carry the distinction — nothing can have aged if
  // nothing ever landed — so the fallback derives it locally rather than
  // reaching back into the contract.
  it('falls back honestly when the server publishes no readiness', () => {
    ok([{ platform: 'META', connected: true, stale: true, lastSyncedAt: null }]);
    const { container } = rail();
    expect(container.textContent).toMatch(/never synced/i);
    expect(container.textContent).not.toMatch(/Stale\s*·\s*never/i);
  });

  it('…and still reports a genuinely aged one as stale without readiness', () => {
    ok([{ platform: 'META', connected: true, stale: true,
          lastSyncedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);
    expect(rail().container.textContent).toMatch(/Stale · 3d ago/);
  });

  // A channel with no credential row at all is a THIRD thing, and was already
  // right. Pinned so the fix above cannot collapse it into "never synced".
  it('"not connected" is not the same claim as "never synced"', () => {
    ok([]);
    const { container } = rail();
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/never synced/i);
  });
});
