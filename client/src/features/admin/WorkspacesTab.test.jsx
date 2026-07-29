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

const { fetchWorkspaces, fetchWorkspaceDetail, seedDemo, deleteDemo, deleteWorkspace, updateWorkspacePlan } = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(), fetchWorkspaceDetail: vi.fn(),
  seedDemo: vi.fn(), deleteDemo: vi.fn(), deleteWorkspace: vi.fn(), updateWorkspacePlan: vi.fn(),
}));
vi.mock('./api.js', () => ({ fetchWorkspaces, fetchWorkspaceDetail, seedDemo, deleteDemo, deleteWorkspace, updateWorkspacePlan }));
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
    expect(screen.getByText('1 workspace total')).toBeInTheDocument();
    expect(screen.getByText('EGP')).toBeInTheDocument();
  });

  it('an empty list says so', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [], total: 0 });
    render(<WorkspacesTab />);
    expect(await screen.findByText('No workspaces.')).toBeInTheDocument();
  });

  // Both kinds are deletable now, but NOT by the same control: a demo is a
  // throwaway seed (two clicks), a real workspace is a customer account and
  // opens the typed-confirmation dialog.
  it('a real workspace offers the guarded delete, not the two-click one', async () => {
    await renderTab();
    expect(screen.getByRole('button', { name: 'Delete Acme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('a demo workspace keeps the cheap two-click delete', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [{ ...WS, isDemo: true }], total: 1 });
    await renderTab();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Acme' })).not.toBeInTheDocument();
  });

  it('opens the typed-confirmation dialog for a real workspace', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete Acme' })).toBeInTheDocument();
    expect(deleteWorkspace).not.toHaveBeenCalled(); // opening is not deleting
  });
});

// ── Search + pagination ─────────────────────────────────────
// `total` is the server's count under the active filters, so it can and does
// exceed the rows on screen. Presenting the page length as the total told an
// operator with 250 workspaces that they had 100.
describe('WorkspacesTab — the total is the server count', () => {
  it('states a total larger than the page it is showing', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [WS], total: 312 });
    render(<WorkspacesTab />);
    expect(await screen.findByText('312 workspaces total')).toBeInTheDocument();
  });

  it('says "matching filters" once a filter is on', async () => {
    await renderTab();
    fetchWorkspaces.mockResolvedValue({ workspaces: [WS], total: 4 });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by plan'), { target: { value: 'PRO' } });
    });

    expect(await screen.findByText('4 workspaces matching filters')).toBeInTheDocument();
  });

  // "No workspaces." under an active search would read as "you have none".
  it('distinguishes an empty search from an empty install', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [], total: 0 });
    render(<WorkspacesTab />);
    expect(await screen.findByText('No workspaces.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by plan'), { target: { value: 'PRO' } });
    });
    expect(await screen.findByText('No workspaces match these filters.')).toBeInTheDocument();
  });
});

describe('WorkspacesTab — server-side filters', () => {
  it('queries page one with no filters on mount', async () => {
    await renderTab();
    expect(fetchWorkspaces).toHaveBeenCalledWith({ q: '', plan: '', demo: '', limit: 25, offset: 0 });
  });

  it('sends the plan filter to the server', async () => {
    await renderTab();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by plan'), { target: { value: 'PRO' } });
    });
    expect(fetchWorkspaces).toHaveBeenLastCalledWith(expect.objectContaining({ plan: 'PRO' }));
  });

  it('sends the demo filter to the server', async () => {
    await renderTab();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by demo'), { target: { value: 'true' } });
    });
    expect(fetchWorkspaces).toHaveBeenLastCalledWith(expect.objectContaining({ demo: 'true' }));
  });

  // Typing must not fire a request per keystroke — the debounce is the point.
  it('debounces the search box', async () => {
    vi.useFakeTimers();
    try {
      render(<WorkspacesTab />);
      await act(async () => { await Promise.resolve(); });
      fetchWorkspaces.mockClear();

      const box = screen.getByLabelText('Search workspaces');
      for (const value of ['a', 'ac', 'acm', 'acme']) {
        fireEvent.change(box, { target: { value } });
        act(() => { vi.advanceTimersByTime(50); });
      }
      expect(fetchWorkspaces).not.toHaveBeenCalled();

      await act(async () => { vi.advanceTimersByTime(300); });
      expect(fetchWorkspaces).toHaveBeenCalledTimes(1);
      expect(fetchWorkspaces).toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WorkspacesTab — pagination', () => {
  it('is hidden when everything fits on one page', async () => {
    await renderTab();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('pages forward by asking the server for the next offset', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [WS], total: 312 });
    render(<WorkspacesTab />);
    const next = await screen.findByRole('button', { name: 'Next page' });

    await act(async () => { fireEvent.click(next); });

    expect(fetchWorkspaces).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }));
  });

  // Page 4 of the old result set is not page 4 of the new one.
  it('returns to page one when a filter changes', async () => {
    fetchWorkspaces.mockResolvedValue({ workspaces: [WS], total: 312 });
    render(<WorkspacesTab />);
    // findBy MUST be resolved outside act — act batches the flush it waits on.
    const next = await screen.findByRole('button', { name: 'Next page' });
    await act(async () => { fireEvent.click(next); });
    expect(fetchWorkspaces).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by plan'), { target: { value: 'PRO' } });
    });

    expect(fetchWorkspaces).toHaveBeenLastCalledWith(expect.objectContaining({ plan: 'PRO', offset: 0 }));
  });
});
