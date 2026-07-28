// ============================================================
// Admin · WorkspaceDetail — the drill-down body
// ------------------------------------------------------------
// Presentational, so every test is really the same question: does it show what
// the server actually said, and does it say "—" rather than something plausible
// when the server said nothing?
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorkspaceDetail } from './WorkspaceDetail.jsx';

const detail = (over = {}) => ({
  workspace: {
    id: 'ws-1', name: 'Acme', plan: 'PRO', currency: 'EGP',
    spendTier: 't2', objective: 'roas', adChannels: ['META', 'GOOGLE'],
    measurementTier: 'NONE', networkConsent: false,
    users: [{ id: 'u-1', email: 'a@acme.co', role: 'VIEWER', collabRole: 'BUYER', createdAt: null }],
    _count: { users: 1, campaignEntities: 12, decisions: 40, accounts: 2, metricSnapshots: 900 },
    ...over.workspace,
  },
  loopRuns: over.loopRuns ?? [],
  connectors: over.connectors ?? { ok: true, connections: [] },
});

const connection = (over = {}) => ({
  platform: 'META', isActive: true, accountId: 'act_1',
  lastSyncedAt: '2026-07-27T09:00:00.000Z',
  lastSuccessfulSync: '2026-07-27T09:00:00.000Z',
  lastAttemptedSync: '2026-07-27T10:00:00.000Z',
  lastError: null, recordsImported: 42, ...over,
});

const sweep = (over = {}) => ({
  id: 'lr-1', trigger: 'SCHEDULED', startedAt: '2026-07-27T08:00:00.000Z',
  finishedAt: '2026-07-27T08:01:00.000Z', closed: true, loopHealth: 'HEALTHY',
  staleStages: [], summary: 'Nothing needed attention', ...over,
});

/** The column whose heading matches — headings are the only stable anchor. */
const column = (name) => screen.getByText(name).parentElement;

describe('WorkspaceDetail — members and counts', () => {
  it('lists members with their effective role', async () => {
    render(<WorkspaceDetail detail={detail()} />);
    expect(screen.getByText('a@acme.co')).toBeInTheDocument();
    expect(screen.getByText('BUYER')).toBeInTheDocument();
  });

  // null collabRole is not "no role" — roleScope reads it as STRATEGIST.
  it('shows a null collabRole as STRATEGIST', () => {
    render(<WorkspaceDetail detail={detail({ workspace: {
      users: [{ id: 'u-1', email: 'a@acme.co', collabRole: null }],
      _count: { users: 1 },
    } })} />);
    expect(screen.getByText('STRATEGIST')).toBeInTheDocument();
  });

  // The server caps the list at 50; presenting it as the whole roster would
  // make a 312-member workspace read as 50.
  it('says when the member list is truncated', () => {
    render(<WorkspaceDetail detail={detail({ workspace: { _count: { users: 312 } } })} />);
    expect(screen.getByText('Members (312)')).toBeInTheDocument();
    expect(screen.getByText(/showing 1 of 312/i)).toBeInTheDocument();
  });

  it('does not claim truncation when the list is complete', () => {
    render(<WorkspaceDetail detail={detail()} />);
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it('renders the entity counts', () => {
    render(<WorkspaceDetail detail={detail()} />);
    const members = column('Members (1)');
    expect(within(members).getByText('12')).toBeInTheDocument();  // campaigns
    expect(within(members).getByText('900')).toBeInTheDocument(); // snapshots
  });

  it('an empty workspace says so', () => {
    render(<WorkspaceDetail detail={detail({ workspace: { users: [], _count: { users: 0 } } })} />);
    expect(screen.getByText('No members.')).toBeInTheDocument();
  });

  it('surfaces the onboarding fields the list never showed', () => {
    render(<WorkspaceDetail detail={detail()} />);
    expect(screen.getByText(/Spend tier t2/)).toBeInTheDocument();
    expect(screen.getByText(/Objective roas/)).toBeInTheDocument();
    expect(screen.getByText(/Channels META, GOOGLE/)).toBeInTheDocument();
  });

  it('shows an em dash for onboarding fields that were skipped', () => {
    render(<WorkspaceDetail detail={detail({ workspace: { spendTier: null, objective: null, adChannels: [] } })} />);
    expect(screen.getByText('Spend tier —')).toBeInTheDocument();
    expect(screen.getByText('Channels —')).toBeInTheDocument();
  });
});

describe('WorkspaceDetail — connectors', () => {
  it('renders a connector with its health', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [connection()] } })} />);
    expect(screen.getByText('META')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows the last error when a sync is failing', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [
      connection({ lastError: 'OAuthException: token expired' }),
    ] } })} />);
    expect(screen.getByText(/token expired/)).toBeInTheDocument();
  });

  // A partial sync is a third state: data DID land, so it is not an error —
  // but the figures are knowingly incomplete and must say so.
  it('shows a partial-sync warning distinctly from an error', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [
      connection({ lastWarning: 'Large account: some ad sets were not read this sync.' }),
    ] } })} />);

    const warning = screen.getByText(/some ad sets were not read/i);
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveClass('text-signal-hold'); // amber, not the kill red
  });

  it('a clean sync shows no warning line', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [connection()] } })} />);
    expect(screen.queryByText(/were not read/i)).not.toBeInTheDocument();
  });

  it('a healthy connector shows no error line', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [connection()] } })} />);
    expect(screen.queryByText(/OAuthException/)).not.toBeInTheDocument();
  });

  it('marks an inactive credential', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [connection({ isActive: false })] } })} />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  // A connector that never synced must not render as "just now" or 0.
  it('shows em dashes for a credential with no health record', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: true, connections: [connection({
      lastSuccessfulSync: null, lastAttemptedSync: null, recordsImported: null,
    })] } })} />);
    const connectors = column('Connectors');
    expect(within(connectors).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('a workspace with no connectors says so', () => {
    render(<WorkspaceDetail detail={detail()} />);
    expect(screen.getByText('No connectors.')).toBeInTheDocument();
  });

  // The degraded block must not take the rest of the panel down with it.
  it('a degraded connector read shows its message and leaves the rest intact', () => {
    render(<WorkspaceDetail detail={detail({ connectors: { ok: false, error: 'Connector status unavailable' } })} />);
    expect(screen.getByText('Connector status unavailable')).toBeInTheDocument();
    expect(screen.getByText('a@acme.co')).toBeInTheDocument();
  });
});

describe('WorkspaceDetail — sweeps', () => {
  it('renders a sweep with its trigger and health', () => {
    render(<WorkspaceDetail detail={detail({ loopRuns: [sweep()] })} />);
    expect(screen.getByText('SCHEDULED · HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('Nothing needed attention')).toBeInTheDocument();
  });

  it.each([
    ['HEALTHY', 'text-signal-scale'],
    ['DEGRADED', 'text-signal-hold'],
    ['STALLED', 'text-signal-kill'],
  ])('%s uses the %s signal token', (loopHealth, tone) => {
    render(<WorkspaceDetail detail={detail({ loopRuns: [sweep({ loopHealth })] })} />);
    expect(screen.getByText(`SCHEDULED · ${loopHealth}`)).toHaveClass(tone);
  });

  // The thing an operator is actually hunting for.
  it('calls out a sweep that never closed', () => {
    render(<WorkspaceDetail detail={detail({ loopRuns: [sweep({ closed: false, loopHealth: 'STALLED' })] })} />);
    expect(screen.getByText('Loop did not close.')).toBeInTheDocument();
  });

  it('says nothing about closing when the loop closed', () => {
    render(<WorkspaceDetail detail={detail({ loopRuns: [sweep()] })} />);
    expect(screen.queryByText(/did not close/)).not.toBeInTheDocument();
  });

  it('a workspace that never swept says so', () => {
    render(<WorkspaceDetail detail={detail()} />);
    expect(screen.getByText('No sweeps yet.')).toBeInTheDocument();
    expect(screen.getByText('Recent sweeps (0)')).toBeInTheDocument();
  });
});

describe('WorkspaceDetail — nothing to show', () => {
  it.each([[undefined], [null], [{}]])('renders nothing for %s', (d) => {
    const { container } = render(<WorkspaceDetail detail={d} />);
    expect(container).toBeEmptyDOMElement();
  });
});
