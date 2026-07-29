// ============================================================
// Admin · DeleteWorkspaceDialog — the guard, not the theatre
// ------------------------------------------------------------
// Deleting a real workspace is irreversible and cascades everything. The dialog
// exists to make that expensive on purpose: the confirm button stays disabled
// until the operator has typed the workspace name exactly, the magnitude is
// stated in real counts, and the server's refusals are surfaced verbatim —
// including the other-admins escalation, which appears ONLY after the server
// has raised it, never as a pre-emptive "force" checkbox.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { deleteWorkspace } = vi.hoisted(() => ({ deleteWorkspace: vi.fn() }));
vi.mock('./api.js', () => ({ deleteWorkspace }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.jsx';

const WS = { id: 'ws-1', name: 'Acme Media', userCount: 3, decisionCount: 48 };

const setup = (over = {}) => {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(<DeleteWorkspaceDialog workspace={{ ...WS, ...over }} onClose={onClose} onDeleted={onDeleted} />);
  return { onClose, onDeleted };
};

const input = () => screen.getByLabelText(/type .* to confirm/i);
const confirmBtn = () => screen.getByRole('button', { name: /delete workspace|delete anyway/i });
const type = (value) => fireEvent.change(input(), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  deleteWorkspace.mockResolvedValue({ name: WS.name, workspaceId: WS.id, credentialsDeleted: 0 });
});

describe('the typed confirmation', () => {
  it('starts disabled with an empty field', () => {
    setup();
    expect(confirmBtn()).toBeDisabled();
  });

  it.each([
    ['a near miss', 'Acme Medi'],
    ['different case', 'acme media'],
    ['trailing whitespace', 'Acme Media '],
  ])('stays disabled for %s', (_label, value) => {
    setup();
    type(value);
    expect(confirmBtn()).toBeDisabled();
  });

  it('enables only on an exact match', () => {
    setup();
    type('Acme Media');
    expect(confirmBtn()).toBeEnabled();
  });

  it('sends the typed name to the server, which re-checks it', async () => {
    const { onDeleted, onClose } = setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    expect(deleteWorkspace).toHaveBeenCalledWith('ws-1', 'Acme Media', false);
    expect(onDeleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('stating the magnitude', () => {
  it('names the workspace in the heading', () => {
    setup();
    expect(screen.getByRole('alertdialog', { name: 'Delete Acme Media' })).toBeInTheDocument();
  });

  it('quotes the real counts from the row', () => {
    setup();
    expect(screen.getByText('3 members lose access')).toBeInTheDocument();
    expect(screen.getByText('48 decisions destroyed')).toBeInTheDocument();
  });

  it('singularises a workspace with one of each', () => {
    setup({ userCount: 1, decisionCount: 1 });
    expect(screen.getByText('1 member loses access')).toBeInTheDocument();
    expect(screen.getByText('1 decision destroyed')).toBeInTheDocument();
  });

  it('says credentials are revoked — they do not cascade', () => {
    setup();
    expect(screen.getByText(/credentials revoked/i)).toBeInTheDocument();
  });
});

describe('server refusals', () => {
  const reject = (status, data) => deleteWorkspace.mockRejectedValue({ response: { status, data } });

  it('surfaces the refusal verbatim rather than "Delete failed"', async () => {
    reject(409, { error: 'Refusing to delete the workspace you are signed in to. Switch workspaces first.' });
    const { onDeleted } = setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    expect(await screen.findByText(/signed in to/i)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a self-delete refusal offers NO override', async () => {
    reject(409, { error: 'Refusing to delete the workspace you are signed in to.' });
    setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    await screen.findByText(/signed in to/i);
    expect(screen.queryByRole('button', { name: /delete anyway/i })).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the server sends none', async () => {
    deleteWorkspace.mockRejectedValue(new Error('network'));
    setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
  });
});

describe('the other-admins escalation', () => {
  const blocked = () => deleteWorkspace.mockRejectedValueOnce({
    response: { status: 409, data: { error: 'This workspace has 1 other ADMIN member.', admins: ['other@acme.io'] } },
  });

  it('is not offered before the server raises it', () => {
    setup();
    type('Acme Media');
    expect(screen.queryByRole('button', { name: /delete anyway/i })).not.toBeInTheDocument();
  });

  it('names the blocking admins', async () => {
    blocked();
    setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    expect(await screen.findByText('other@acme.io')).toBeInTheDocument();
  });

  it('the override re-sends with force, and only then', async () => {
    blocked();
    const { onDeleted } = setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });

    const override = await screen.findByRole('button', { name: /delete anyway/i });
    await act(async () => { fireEvent.click(override); });

    expect(deleteWorkspace).toHaveBeenNthCalledWith(1, 'ws-1', 'Acme Media', false);
    expect(deleteWorkspace).toHaveBeenNthCalledWith(2, 'ws-1', 'Acme Media', true);
    expect(onDeleted).toHaveBeenCalled();
  });

  // The override must not become a way around the typed name.
  it('the override still requires the exact name', async () => {
    blocked();
    setup();
    type('Acme Media');
    await act(async () => { fireEvent.click(confirmBtn()); });
    await screen.findByRole('button', { name: /delete anyway/i });

    type('wrong');
    expect(screen.getByRole('button', { name: /delete anyway/i })).toBeDisabled();
  });
});

describe('dismissal', () => {
  it('cancel closes without deleting', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  it('Escape closes without deleting', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });

  // The confirm button relabels to "Deleting…" while in flight, so this queries
  // the busy label rather than the idle one.
  it('does not close mid-delete', async () => {
    let resolve;
    deleteWorkspace.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onClose } = setup();
    type('Acme Media');
    fireEvent.click(confirmBtn());

    await screen.findByRole('button', { name: 'Deleting…' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { resolve({ name: WS.name }); });
  });
});
