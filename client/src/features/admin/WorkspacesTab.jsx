// ============================================================
// MARCOM / Admin — Tab 2 · Workspaces
// All workspaces with user/decision counts. Seed a demo; delete demos inline
// (two-click confirm). The Delete button only renders on demo workspaces — the
// backend independently refuses any non-demo delete, so this is defence-in-depth.
// ============================================================
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { fetchWorkspaces, seedDemo, deleteDemo } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium' }); } catch { return '—'; }
}

function DeleteCell({ id, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteDemo(id);
      toast.success('Demo workspace deleted');
      onDeleted();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Delete failed');
    } finally { setBusy(false); }
  };

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="rounded-md border border-trend-danger px-2 py-1 text-xs text-trend-danger transition-colors hover:bg-trend-danger hover:text-lumi-bg">
        Delete
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={remove}
        className="rounded-md bg-trend-danger px-2 py-1 text-xs text-lumi-bg disabled:opacity-50">
        {busy ? '…' : 'Confirm'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-lumi-muted hover:text-lumi-text">
        Cancel
      </button>
    </span>
  );
}

export function WorkspacesTab() {
  const { data, loading, error, reload } = useAsync(fetchWorkspaces);
  const [seeding, setSeeding] = useState(false);

  const onSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await seedDemo();
      toast.success(`Created: ${res.name}`);
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Seed failed');
    } finally { setSeeding(false); }
  }, [reload]);

  const rows = data?.workspaces ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-lumi-muted">{data ? `${data.total} workspaces` : ''}</p>
        <button type="button" onClick={onSeed} disabled={seeding}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:opacity-50">
          {seeding ? 'Seeding…' : 'Seed demo workspace'}
        </button>
      </div>

      <AsyncBlock loading={loading} error={error} empty={rows.length === 0} emptyLabel="No workspaces.">
        <div className="overflow-x-auto rounded-xl border border-lumi-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-lumi-border bg-lumi-surface font-mono text-[11px] uppercase tracking-[0.1em] text-lumi-subtle">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Currency</th>
                <th className="px-3 py-2 text-right">Users</th>
                <th className="px-3 py-2 text-right">Decisions</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-lumi-border/50 last:border-0">
                  <td className="px-3 py-2 text-lumi-text">
                    {w.name}
                    {w.isDemo && (
                      <span className="ml-2 rounded bg-lumi-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-lumi-accent">demo</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-lumi-muted">{w.currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-lumi-muted">{w.userCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-lumi-muted">{w.decisionCount}</td>
                  <td className="px-3 py-2 text-lumi-muted">{fmtDate(w.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {w.isDemo ? <DeleteCell id={w.id} onDeleted={reload} /> : <span className="text-lumi-subtle">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBlock>
    </div>
  );
}
