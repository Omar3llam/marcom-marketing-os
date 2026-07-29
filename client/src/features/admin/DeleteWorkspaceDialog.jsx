// ============================================================
// MARCOM / Admin — Delete workspace (typed confirmation)
// ------------------------------------------------------------
// The one irreversible action in the panel. Everything cascades: campaigns,
// snapshots, decisions, outcomes, memberships, connector credentials. There is
// no undo and no soft delete, so the dialog does three things a two-click
// confirm cannot:
//
//   1. Makes the operator TYPE the workspace name. You cannot confirm without
//      having read the name of the thing you are destroying, which is the only
//      guard that actually catches a misclicked row.
//   2. States what will be destroyed, in real counts from the row — never a
//      vague "this cannot be undone" with no magnitude.
//   3. Surfaces the server's refusals verbatim, including the other-admins
//      escalation, rather than collapsing them into "Delete failed".
//
// The server re-checks the typed name and the guards independently. This dialog
// is the humane surface, not the enforcement.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { deleteWorkspace } from './api.js';

export function DeleteWorkspaceDialog({ workspace, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Set only when the server refuses because other ADMINs remain — the ONLY
  // refusal that offers an override. A self-delete refusal never gets one.
  const [blockingAdmins, setBlockingAdmins] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Exact match, same rule the server applies. No trim, no case-folding — a
  // near-miss is a near-miss.
  const matches = typed === workspace.name;

  const submit = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteWorkspace(workspace.id, typed, force);
      toast.success(`Deleted ${res.name}`);
      onDeleted();
      onClose();
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.error || 'Delete failed');
      setBlockingAdmins(Array.isArray(data?.admins) ? data.admins : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-base/60 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete ${workspace.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-signal-kill/40 bg-lumi-surface p-6 shadow-card"
      >
        <div className="mb-3 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal-kill" strokeWidth={2} />
          <h2 className="font-display text-base font-semibold text-signal-kill">
            Delete {workspace.name}?
          </h2>
        </div>

        <p className="mb-3 text-sm leading-relaxed text-lumi-muted">
          This permanently destroys the workspace and everything in it. It cannot be undone.
        </p>

        {/* Magnitude, from the row's own counts. The two the list already knows
            are shown as real numbers; the rest is named honestly without a
            fabricated figure attached. */}
        <ul className="mb-4 space-y-1 rounded-lg border border-lumi-border bg-lumi-bg/40 px-3 py-2 font-mono text-[11px] text-lumi-muted">
          <li>
            {workspace.userCount} member{workspace.userCount === 1 ? ' loses' : 's lose'} access
          </li>
          <li>{workspace.decisionCount} decision{workspace.decisionCount === 1 ? '' : 's'} destroyed</li>
          <li>All campaigns, ad sets, snapshots and outcomes destroyed</li>
          <li>Connected ad-platform credentials revoked</li>
        </ul>

        <label htmlFor="confirm-name" className="mb-1.5 block text-xs text-lumi-muted">
          Type <span className="font-mono text-lumi-text">{workspace.name}</span> to confirm
        </label>
        <input
          id="confirm-name"
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoComplete="off"
          className="mb-4 w-full rounded-md border border-lumi-border bg-lumi-bg px-3 py-2 font-mono text-xs text-lumi-text focus:border-signal-kill focus:outline-none disabled:opacity-50"
        />

        {error && (
          <div className="mb-4 rounded-lg border border-signal-kill/40 bg-signal-kill/5 px-3 py-2 text-xs text-signal-kill">
            <p>{error}</p>
            {blockingAdmins?.length > 0 && (
              <p className="mt-1 font-mono text-[10px] text-lumi-muted">{blockingAdmins.join(', ')}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-lumi-border px-4 py-2 text-sm text-lumi-muted transition-colors hover:bg-lumi-elevated disabled:opacity-50"
          >
            Cancel
          </button>

          {/* The override appears ONLY after the server has refused for that
              specific reason — never as a pre-emptive "force" checkbox that an
              operator could tick before knowing there was anything to override. */}
          {blockingAdmins?.length > 0 ? (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy || !matches}
              className="rounded-lg bg-signal-kill px-4 py-2 text-sm font-medium text-lumi-surface transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete anyway'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy || !matches}
              className="rounded-lg bg-signal-kill px-4 py-2 text-sm font-medium text-lumi-surface transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete workspace'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
