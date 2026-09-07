// ============================================================
// MARCOM / Admin — Tab 2 · Workspaces
// All workspaces with user/decision counts. Seed a demo; delete demos inline
// (two-click confirm). The Delete button only renders on demo workspaces — the
// backend independently refuses any non-demo delete, so this is defence-in-depth.
// ============================================================
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Loader2 } from 'lucide-react';
import { fetchWorkspaces, fetchWorkspaceDetail, seedDemo, deleteDemo, updateWorkspacePlan } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';
import { WorkspaceDetail } from './WorkspaceDetail.jsx';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog.jsx';
import { useDebounce } from '@/hooks/useDebounce';
import { Pagination } from '@/components/ui/Pagination.jsx';

const PLAN_OPTIONS = ['FREE', 'GROWTH', 'PRO'];
const COLS = 7; // keep in sync with the <thead> below
const PAGE_SIZE = 25;

const CONTROL =
  'rounded-md border border-lumi-border bg-lumi-surface px-2 py-1.5 text-xs text-lumi-text focus:border-lumi-accent focus:outline-none';

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium' }); } catch { return '—'; }
}

// Feature-gating entitlement selector. Manual upgrade path (no billing) — an
// admin picks the tier; the change persists on select and reloads the row set.
function PlanCell({ id, plan }) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(plan ?? 'FREE');

  const onChange = async (e) => {
    const next = e.target.value;
    const prev = value;
    setValue(next);       // optimistic
    setBusy(true);
    try {
      await updateWorkspacePlan(id, next);
      toast.success(`Plan → ${next}`);
    } catch (err) {
      setValue(prev);     // revert on failure — never show a plan we didn't set
      toast.error(err?.response?.data?.error || 'Plan update failed');
    } finally { setBusy(false); }
  };

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={busy}
      aria-label="Workspace plan"
      className="rounded-md border border-lumi-border bg-lumi-surface px-2 py-1 font-mono text-xs text-lumi-text disabled:opacity-50"
    >
      {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

// Two delete paths, deliberately not one control.
//
// A demo workspace is a throwaway seed: two clicks, no typing, and the server
// refuses anything without the "Demo —" sentinel anyway. A REAL workspace is a
// customer account — it opens the typed-confirmation dialog instead. Sharing one
// control would either make demo teardown tedious or make destroying a customer
// account as cheap as deleting a seed.
function DemoDeleteCell({ id, onDeleted }) {
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

// One workspace row plus its lazily-fetched drill-down.
//
// The toggle is a BUTTON in the name cell, not a click handler on the <tr>: the
// row already contains a plan <select> and the delete confirm, whose clicks
// would bubble into a row handler and expand the panel every time an operator
// changed a plan. A button is also reachable by keyboard, which a clickable
// table row is not.
// `onRequestDelete` rather than a dialog owned per row: the dialog is a <div>,
// and a <div> rendered between <tr>s inside a <tbody> is invalid HTML that the
// parser lifts out of the table. It lives above the table in WorkspacesTab.
function WorkspaceRow({ w, onDeleted, onRequestDelete }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(null);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (detail) return; // cached — one fetch per workspace per mount

    setLoading(true);
    setFailed(null);
    try {
      setDetail(await fetchWorkspaceDetail(w.id));
    } catch (err) {
      setFailed(err?.message ?? 'Failed to load workspace details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr className="border-b border-lumi-border/50 last:border-0">
        <td className="px-3 py-2 text-lumi-text">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={`Details for ${w.name}`}
            className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-lumi-accent"
          >
            <ChevronRight
              className={`h-3 w-3 flex-shrink-0 text-lumi-muted transition-transform duration-200 ${open ? 'rotate-90 text-lumi-accent' : ''}`}
              strokeWidth={2}
            />
            {w.name}
          </button>
          {w.isDemo && (
            <span className="ml-2 rounded bg-lumi-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-lumi-accent">demo</span>
          )}
        </td>
        <td className="px-3 py-2"><PlanCell id={w.id} plan={w.plan} /></td>
        <td className="px-3 py-2 font-mono text-lumi-muted">{w.currency}</td>
        <td className="px-3 py-2 text-right tabular-nums text-lumi-muted">{w.userCount}</td>
        <td className="px-3 py-2 text-right tabular-nums text-lumi-muted">{w.decisionCount}</td>
        <td className="px-3 py-2 text-lumi-muted">{fmtDate(w.createdAt)}</td>
        <td className="px-3 py-2 text-right">
          {w.isDemo ? (
            <DemoDeleteCell id={w.id} onDeleted={onDeleted} />
          ) : (
            <button
              type="button"
              onClick={() => onRequestDelete(w)}
              aria-label={`Delete ${w.name}`}
              className="rounded-md border border-trend-danger px-2 py-1 text-xs text-trend-danger transition-colors hover:bg-trend-danger hover:text-lumi-bg"
            >
              Delete
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-lumi-border/50">
          <td colSpan={COLS} className="bg-lumi-elevated/50 px-6 py-4">
            {loading && (
              <p className="flex items-center gap-1.5 text-xs text-lumi-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Loading details…
              </p>
            )}
            {failed && <p className="text-xs text-signal-kill">{failed}</p>}
            {!loading && !failed && detail && <WorkspaceDetail detail={detail} />}
          </td>
        </tr>
      )}
    </>
  );
}

export function WorkspacesTab() {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [demo, setDemo] = useState('');
  const [offset, setOffset] = useState(0);
  const [seeding, setSeeding] = useState(false);
  // The workspace awaiting typed confirmation, or null. One dialog for the whole
  // table — it must sit outside <table> to be valid HTML.
  const [deleteTarget, setDeleteTarget] = useState(null);

  const debouncedQ = useDebounce(q, 300);

  // useAsync re-runs whenever the fetcher's identity changes, so memoizing on
  // the query params IS the refetch trigger. Its cleanup cancels the in-flight
  // request, which is what keeps a slow early keystroke from landing on top of
  // a later one.
  const fetcher = useCallback(
    () => fetchWorkspaces({ q: debouncedQ, plan, demo, limit: PAGE_SIZE, offset }),
    [debouncedQ, plan, demo, offset],
  );
  const { data, loading, error, reload } = useAsync(fetcher);

  // Any filter change invalidates the current page number — page 4 of the old
  // result set is not page 4 of the new one.
  const filtered = Boolean(debouncedQ || plan || demo);
  const onFilter = (setter) => (value) => { setter(value); setOffset(0); };

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
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => onFilter(setQ)(e.target.value)}
            placeholder="Search workspaces…"
            aria-label="Search workspaces"
            className={`${CONTROL} max-w-xs flex-1 placeholder:text-lumi-subtle`}
          />
          <select value={plan} onChange={(e) => onFilter(setPlan)(e.target.value)}
            aria-label="Filter by plan" className={CONTROL}>
            <option value="">All plans</option>
            {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={demo} onChange={(e) => onFilter(setDemo)(e.target.value)}
            aria-label="Filter by demo" className={CONTROL}>
            <option value="">All</option>
            <option value="false">Real</option>
            <option value="true">Demo</option>
          </select>
        </div>
        <button type="button" onClick={onSeed} disabled={seeding}
          className="flex-shrink-0 rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-gold disabled:opacity-50">
          {seeding ? 'Seeding…' : 'Seed demo workspace'}
        </button>
      </div>

      {/* The server's count under the active filters — not the length of the
          page, which used to report 100 for an install with 250 workspaces. */}
      <p className="text-sm text-lumi-muted">
        {data ? `${total} workspace${total === 1 ? '' : 's'}${filtered ? ' matching filters' : ' total'}` : ''}
      </p>

      <AsyncBlock
        loading={loading}
        error={error}
        empty={rows.length === 0}
        emptyLabel={filtered ? 'No workspaces match these filters.' : 'No workspaces.'}
      >
        <div className="overflow-x-auto rounded-xl border border-lumi-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-lumi-border bg-lumi-surface font-mono text-[11px] uppercase tracking-[0.1em] text-lumi-subtle">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Currency</th>
                <th className="px-3 py-2 text-right">Users</th>
                <th className="px-3 py-2 text-right">Decisions</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <WorkspaceRow key={w.id} w={w} onDeleted={reload} onRequestDelete={setDeleteTarget} />
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBlock>

      <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPageChange={setOffset} />

      {deleteTarget && (
        <DeleteWorkspaceDialog
          workspace={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={reload}
        />
      )}
    </div>
  );
}
