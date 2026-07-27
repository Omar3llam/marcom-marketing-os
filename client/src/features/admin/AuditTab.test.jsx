// ============================================================
// Admin · AuditTab — the action log surface
// ------------------------------------------------------------
// The paging behaviour is the part worth pinning: pages ACCUMULATE, and the
// "Load more" affordance must disappear when the server says there is no
// cursor — otherwise an operator keeps clicking a button that re-serves the
// same page.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { fetchAuditLog } = vi.hoisted(() => ({ fetchAuditLog: vi.fn() }));
vi.mock('./api.js', () => ({ fetchAuditLog }));

import { AuditTab } from './AuditTab.jsx';

const log = (over = {}) => ({
  id: 'log-1', actorEmail: 'ops@marcom.dev', type: 'CHANGE_ROLE',
  targetType: 'USER', targetId: 'c52262ec-fed1-4697-8f7a-982efea99fb0', workspaceId: 'ws-1',
  before: { collabRole: 'STRATEGIST' }, after: { collabRole: 'BUYER', forced: false },
  createdAt: '2026-07-27T10:00:00.000Z', ...over,
});

// findBy* must resolve OUTSIDE act(): act batches the flush that findBy is
// waiting on, so awaiting one inside it deadlocks until the query times out.
const findLoadMore = () => screen.findByRole('button', { name: /load more/i });

beforeEach(() => {
  vi.clearAllMocks();
  fetchAuditLog.mockResolvedValue({ logs: [log()], nextCursor: null });
});

describe('AuditTab — rendering', () => {
  it('shows the actor, the action and the change', async () => {
    render(<AuditTab />);
    expect(await screen.findByText('ops@marcom.dev')).toBeInTheDocument();
    expect(screen.getByText('Changed role')).toBeInTheDocument();
    expect(screen.getByText(/Strategist → Buyer/)).toBeInTheDocument();
  });

  it('truncates the target id but keeps the full value reachable', async () => {
    render(<AuditTab />);
    const cell = (await screen.findByText(/c52262ec…/)).closest('td');
    expect(cell).toHaveAttribute('title', 'c52262ec-fed1-4697-8f7a-982efea99fb0');
  });

  it('flags a forced downgrade', async () => {
    fetchAuditLog.mockResolvedValue({
      logs: [log({ after: { collabRole: 'BUYER', forced: true } })], nextCursor: null,
    });
    render(<AuditTab />);
    expect(await screen.findByText('Forced')).toBeInTheDocument();
  });

  it('does not flag an ordinary change', async () => {
    render(<AuditTab />);
    await screen.findByText('ops@marcom.dev');
    expect(screen.queryByText('Forced')).not.toBeInTheDocument();
  });

  // The log starts the day it shipped; pretending otherwise would mislead.
  it('says the log has no history before it existed', async () => {
    render(<AuditTab />);
    expect(await screen.findByText(/earlier\s+actions were never captured/i)).toBeInTheDocument();
  });

  it('an empty log says so rather than rendering a bare table', async () => {
    fetchAuditLog.mockResolvedValue({ logs: [], nextCursor: null });
    render(<AuditTab />);
    expect(await screen.findByText(/no admin actions recorded yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchAuditLog.mockRejectedValue(Object.assign(new Error('Failed to list admin actions'), { httpStatus: 500 }));
    render(<AuditTab />);
    expect(await screen.findByText('Failed to list admin actions')).toBeInTheDocument();
  });
});

describe('AuditTab — paging', () => {
  const firstPage = { logs: [log()], nextCursor: '2026-07-27T10:00:00.000Z' };

  it('hides "Load more" when the server sent no cursor', async () => {
    render(<AuditTab />);
    await screen.findByText('ops@marcom.dev');
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('offers "Load more" when a cursor came back', async () => {
    fetchAuditLog.mockResolvedValue(firstPage);
    render(<AuditTab />);
    expect(await findLoadMore()).toBeInTheDocument();
  });

  it('pages on the cursor and APPENDS — it does not replace the page', async () => {
    fetchAuditLog.mockResolvedValueOnce(firstPage);
    fetchAuditLog.mockResolvedValueOnce({
      logs: [log({ id: 'log-2', actorEmail: 'second@marcom.dev' })], nextCursor: null,
    });

    render(<AuditTab />);
    const btn = await findLoadMore();
    await act(async () => { fireEvent.click(btn); });

    expect(fetchAuditLog).toHaveBeenLastCalledWith('2026-07-27T10:00:00.000Z');
    expect(screen.getByText('ops@marcom.dev')).toBeInTheDocument();   // page 1 kept
    expect(screen.getByText('second@marcom.dev')).toBeInTheDocument(); // page 2 added
  });

  it('the exhausted cursor retires the button', async () => {
    fetchAuditLog.mockResolvedValueOnce(firstPage);
    fetchAuditLog.mockResolvedValueOnce({ logs: [log({ id: 'log-2' })], nextCursor: null });

    render(<AuditTab />);
    const btn = await findLoadMore();
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument());
  });

  it('disables the button and says so while a page is in flight', async () => {
    fetchAuditLog.mockResolvedValueOnce(firstPage);
    let resolve;
    fetchAuditLog.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    render(<AuditTab />);
    // Held by reference: the label becomes "Loading…" mid-flight, so a name
    // query would stop finding the very element under assertion.
    const btn = await findLoadMore();
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveTextContent(/loading/i);

    await act(async () => { resolve({ logs: [], nextCursor: null }); });
  });

  it('the first load asks for no cursor', async () => {
    render(<AuditTab />);
    await screen.findByText('ops@marcom.dev');
    expect(fetchAuditLog).toHaveBeenCalledWith(null);
  });
});
