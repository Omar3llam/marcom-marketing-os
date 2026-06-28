// ============================================================
// MARCOM / Admin — Tab 4 · Demo Management
// Seed a fresh demo workspace; tear down existing ones behind a strict
// "type DELETE to confirm" step (the backend additionally refuses any
// workspace whose name lacks the "Demo —" sentinel).
// ============================================================
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { fetchWorkspaces, seedDemo, deleteDemo } from './api.js';
import { useAsync, AsyncBlock, Card } from './parts.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; }
}

function DemoRow({ ws, onDeleted }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const armed = text === 'DELETE';

  const remove = async () => {
    if (!armed) return;
    setBusy(true);
    try {
      await deleteDemo(ws.id);
      toast.success('Demo workspace deleted');
      onDeleted();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Delete failed');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-lumi-border/50 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-lumi-text">{ws.name}</p>
        <p className="font-mono text-[11px] text-lumi-subtle">{ws.userCount} users · {ws.decisionCount} decisions · {fmtDate(ws.createdAt)}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="type DELETE"
          className="w-28 rounded-md border border-lumi-border bg-lumi-bg px-2 py-1 font-mono text-xs text-lumi-text placeholder:text-lumi-subtle focus:border-trend-danger focus:outline-none"
        />
        <button type="button" disabled={!armed || busy} onClick={remove}
          className="rounded-md bg-trend-danger px-2.5 py-1 text-xs text-lumi-bg disabled:opacity-40">
          {busy ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export function DemoTab() {
  const { data, loading, error, reload } = useAsync(fetchWorkspaces);
  const [seeding, setSeeding] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  const onSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await seedDemo();
      setLastCreated(res.name);
      toast.success('Demo workspace created');
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Seed failed');
    } finally { setSeeding(false); }
  }, [reload]);

  const demos = (data?.workspaces ?? []).filter((w) => w.isDemo);

  return (
    <div className="space-y-4">
      <Card title="Seed">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-lumi-muted">Mint a fresh, fully-populated demo workspace (the Maison Salam 9-phase graph).</p>
          <button type="button" onClick={onSeed} disabled={seeding}
            className="shrink-0 rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:opacity-50">
            {seeding ? 'Seeding…' : 'Seed demo workspace'}
          </button>
        </div>
        {lastCreated && (
          <p className="mt-2 font-mono text-[11px] text-trend-positive">Created: {lastCreated}</p>
        )}
      </Card>

      <Card title={`Existing demo workspaces${data ? ` (${demos.length})` : ''}`}>
        <AsyncBlock loading={loading} error={error} empty={demos.length === 0} emptyLabel="No demo workspaces. Seed one above.">
          <div>
            {demos.map((w) => <DemoRow key={w.id} ws={w} onDeleted={reload} />)}
          </div>
        </AsyncBlock>
      </Card>
    </div>
  );
}
