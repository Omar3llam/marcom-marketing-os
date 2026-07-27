// ============================================================
// Admin · UsersTab — editable collab role
// ------------------------------------------------------------
// The api client maps every error to a domain AppError carrying .httpStatus.
// `err.response` does NOT exist, so the server's `error: 'LAST_STRATEGIST'`
// code cannot be read from the client — the 409 STATUS is the signal, and
// these tests pin that so a `?.response?.data?.error` read can't creep back.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { fetchUsers, updateUserRole } = vi.hoisted(() => ({
  fetchUsers: vi.fn(), updateUserRole: vi.fn(),
}));
vi.mock('./api.js', () => ({ fetchUsers, updateUserRole }));

import { UsersTab } from './UsersTab.jsx';

const USER = {
  id: 'u-1', email: 'member@acme.co', role: 'VIEWER',
  collabRole: 'STRATEGIST', workspaceId: 'ws-1', workspaceName: 'Acme',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const appError = (httpStatus, message) => Object.assign(new Error(message), { httpStatus, code: 'UNKNOWN_ERROR' });

const renderTab = async () => {
  const utils = render(<UsersTab />);
  await screen.findByText('member@acme.co');
  return utils;
};
const roleSelect = () => screen.getByLabelText('Workspace role for member@acme.co');

beforeEach(() => {
  vi.clearAllMocks();
  fetchUsers.mockResolvedValue({ users: [USER], total: 1 });
  updateUserRole.mockResolvedValue({ user: { ...USER, collabRole: 'BUYER' } });
});

describe('UsersTab — role select', () => {
  it('renders the user’s current role', async () => {
    await renderTab();
    expect(roleSelect()).toHaveValue('STRATEGIST');
  });

  it('a null collabRole presents as STRATEGIST (the product-wide default)', async () => {
    fetchUsers.mockResolvedValue({ users: [{ ...USER, collabRole: null }], total: 1 });
    await renderTab();
    expect(roleSelect()).toHaveValue('STRATEGIST');
  });

  it('changing the role PATCHes without force and refetches', async () => {
    await renderTab();
    await act(async () => { fireEvent.change(roleSelect(), { target: { value: 'BUYER' } }); });
    expect(updateUserRole).toHaveBeenCalledWith('u-1', 'BUYER', false);
    await waitFor(() => expect(fetchUsers).toHaveBeenCalledTimes(2)); // reloaded
  });

  it('disables the select while the request is in flight', async () => {
    let resolve;
    updateUserRole.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderTab();
    fireEvent.change(roleSelect(), { target: { value: 'BUYER' } });
    await waitFor(() => expect(roleSelect()).toBeDisabled());
    await act(async () => { resolve({}); });
    await waitFor(() => expect(roleSelect()).toBeEnabled());
  });
});

describe('UsersTab — last-strategist confirmation', () => {
  const triggerConflict = async () => {
    updateUserRole.mockRejectedValueOnce(appError(409, 'This is the last strategist in the workspace.'));
    await renderTab();
    await act(async () => { fireEvent.change(roleSelect(), { target: { value: 'BUYER' } }); });
  };

  it('a 409 opens the confirm modal — not window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    await triggerConflict();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Last strategist in workspace/i)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('the modal names the user and the consequence', async () => {
    await triggerConflict();
    // Scoped to the dialog — the email also appears in the table row behind it.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/member@acme\.co/);
    expect(dialog.textContent).toMatch(/no strategist/i);
  });

  it('confirming retries with force: true in the BODY', async () => {
    await triggerConflict();
    updateUserRole.mockResolvedValue({ user: { ...USER, collabRole: 'BUYER' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /downgrade anyway/i })); });

    expect(updateUserRole).toHaveBeenLastCalledWith('u-1', 'BUYER', true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('cancelling closes the modal and changes nothing', async () => {
    await triggerConflict();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(updateUserRole).toHaveBeenCalledTimes(1); // never retried
  });
});

describe('UsersTab — other failures', () => {
  it('surfaces the server message inline, with no modal', async () => {
    updateUserRole.mockRejectedValue(appError(400, 'Invalid role.'));
    await renderTab();
    await act(async () => { fireEvent.change(roleSelect(), { target: { value: 'CLIENT' } }); });

    expect(await screen.findByText('Invalid role.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('an error with no message still says something', async () => {
    updateUserRole.mockRejectedValue({ httpStatus: 500 });
    await renderTab();
    await act(async () => { fireEvent.change(roleSelect(), { target: { value: 'CLIENT' } }); });
    expect(await screen.findByText(/failed to update role/i)).toBeInTheDocument();
  });

  // Guards the regression this whole file exists for.
  it('an axios-shaped error is NOT how the conflict is detected', async () => {
    updateUserRole.mockRejectedValue({ response: { data: { error: 'LAST_STRATEGIST' } } });
    await renderTab();
    await act(async () => { fireEvent.change(roleSelect(), { target: { value: 'BUYER' } }); });
    // No httpStatus → treated as a plain failure. If this ever opens a modal,
    // someone reintroduced a `?.response?.data` read that production never sees.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
