// ============================================================
// Admin · WorkspacesTab — the row expand
// ------------------------------------------------------------
// The expand is a BUTTON in the name cell, not a click handler on the <tr>.
// The row already carries a plan <select> and the delete confirm, whose clicks
// would bubble into a row handler and expand the panel every time an operator
// changed a plan — so that regression is pinned here explicitly.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { fetchWorkspaces, fetchWorkspaceDetail, seedDemo, deleteDemo, updateWorkspacePlan } = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(), fetchWorkspaceDetail: vi.fn(),
  seedDemo: vi.fn(), deleteDemo: vi.fn(), updateWorkspacePlan: vi.fn(),
}));
vi.mock('./api.js', () => ({ fetchWorkspaces, fetchWorkspaceDetail, seedDemo, deleteDemo, updateWorkspacePlan }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WorkspacesTab } from './WorkspacesTab.jsx';

const WS = {
  id: 'ws-1', name: 'Acme', plan: 'PRO', currency: 'EGP',
  userCount: 3, decisionCount: 40, createdAt: '2026-01-01T00:00:00.000Z', isDemo: false,
};

const DETAIL = {
  workspace: {
    id: 'ws-1', name: 'Acme', currency: 'EGP', spendTier: 't2', objective: 'roas',
    adChannels: ['META'], measurementTier: 'NONE', networkConsent: false,
    users: [{ id: 'u-1', email: 'a@acme.co', collabRole: 'BUYER' }],
    _count: { users: 1, campaignEntities: 12, decisions: 40, accounts: 2, metricSnapshots: 900 },
  },
  loopRuns: [],
  connectors: { ok: true, connections: [] },
};

const toggle = () => screen.getByRole('button', { name: 'Details for Acme' });

const renderTab = async () => {
  const utils = render(<WorkspacesTab />);
  await screen.findByRole('button', { name: 'Details for Acme' });
  return utils;
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchWorkspaces.mockResolvedValue({ workspaces: [WS], total: 1 });
  fetchWorkspaceDetail.mockResolvedValue(DETAIL);
});

describe('WorkspacesTab — expanding a row', () => {
  it('fetches the detail on first expand', async () => {
    await renderTab();
    expect(fetchWorkspaceDetail).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(toggle()); });
    expect(fetchWorkspaceDetail).toHaveBeenCalledWith('ws-1');
    expect(await screen.findByText('a@acme.co')).toBeInTheDocument();
  });

  it('collapses on a second click without re-fetching', async () => {
    await renderTab();
    await act(async () => { fireEvent.click(toggle()); });
    await screen.findByText('a@acme.co');

    fireEvent.click(toggle());
    await waitFor(() => expect(screen.queryByText('a@acme.co')).not.toBeInTheDocument());
    expect(fetchWorkspaceDetail).toHaveBeenCalledTimes(1);
  });

  it('re-expanding serves the cached detail', async () => {
    await renderTab();
    await act(async () => { fireEvent.click(toggle()); });
    fireEvent.click(toggle());
    await act(async () => { fireEvent.click(toggle()); });

    expect(await screen.findByText('a@acme.co')).toBeInTheDocument();
    expect(fetchWorkspaceDetail).toHaveBeenCalledTimes(1);
  });

  it('reports expansion state to assistive tech', async () => {
    await renderTab();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await act(async () => { fireEvent.click(toggle()); });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows a loading line while the detail is in flight', async () => {
    let resolve;
    fetchWorkspaceDetail.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderTab();

    fireEvent.click(toggle());
    expect(await screen.findByText(/loading details/i)).toBeInTheDocument();

    await act(async () => { resolve(DETAIL); });
    await waitFor(() => expect(screen.queryByText(/loading details/i)).not.toBeInTheDocument());
  });

  it('surfaces a failed detail fetch instead of an empty panel', async () => {
    fetchWorkspaceDetail.mockRejectedValue(Object.assign(new Error('Failed to load workspace'), { httpStatus: 500 }));
    await renderTab();
    await act(async () => { fireEvent.click(toggle()); });

    expect(await screen.findByText('Failed to load workspace')).toBeInTheDocument();
  });

  // A failure must stay retryable — the cache only holds successes.
  it('retries after a failure', async () => {
    fetchWorkspaceDetail.mockRejectedValueOnce(new Error('boom'));
    await renderTab();
    await act(async () => { fireEvent.click(toggle()); });
    await screen.findByText('boom');

    fireEvent.click(toggle());                                   // collapse
    await act(async () => { fireEvent.click(toggle()); });       // expand again
    expect(await screen.findByText('a@acme.co')).toBeInTheDocument();
    expect(fetchWorkspaceDetail).toHaveBeenCalledTimes(2);
  });
});

describe('WorkspacesTab — the expand does not hijack the row', () => {
  it('changing the plan does not expand the row', async () => {
    updateWorkspacePlan.mockResolvedValue({});
    await renderTab();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Workspace plan'), { target: { value: 'FREE' } });
    });

    expect(fetchWorkspaceDetail).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starting a demo delete does not expand the row', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [{ ...WS, isDemo: true }], total: 1 });
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(fetchWorkspaceDetail).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('WorkspacesTab — the list itself still works', () => {
  it('renders the row', async () => {
    await renderTab();
    expect(screen.getByText('1 workspaces')).toBeInTheDocument();
    expect(screen.getByText('EGP')).toBeInTheDocument();
  });

  it('an empty list says so', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [], total: 0 });
    render(<WorkspacesTab />);
    expect(await screen.findByText('No workspaces.')).toBeInTheDocument();
  });

  it('only demo workspaces offer Delete', async () => {
    await renderTab();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
