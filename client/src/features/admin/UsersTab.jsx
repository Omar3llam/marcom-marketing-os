// ============================================================
// MARCOM / Admin — Tab 3 · Users
// All users with system role / collab role / workspace. Filter by system role.
// The collab role is editable here: this is the only cross-workspace surface,
// so it is the only place an admin can repair a workspace that locked itself out.
// ============================================================
import { useState, useCallback } from 'react';
import { fetchUsers, updateUserRole } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';
import { ConfirmModal } from '@/components/ui/ConfirmModal.jsx';
import { useDebounce } from '@/hooks/useDebounce';
import { Pagination } from '@/components/ui/Pagination.jsx';

// '' is the "no filter" value, sent as an absent param rather than role=ALL.
const FILTERS = [
  { value: '', label: 'ALL' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'VIEWER', label: 'VIEWER' },
];
const PAGE_SIZE = 25;
// Mirrors the Prisma WorkspaceRole enum (and src/lib/workspaceGuards.js).
const WORKSPACE_ROLES = ['STRATEGIST', 'BUYER', 'CLIENT'];
const titleCase = (r) => r.charAt(0) + r.slice(1).toLowerCase();

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium' }); } catch { return '—'; }
}

function RoleSelect({ user, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // role awaiting confirmation

  const change = async (role, force = false) => {
    setBusy(true);
    setError(null);
    try {
      await updateUserRole(user.id, role, force);
      onChanged();
    } catch (err) {
      // The api client maps every error to a domain AppError carrying
      // .httpStatus — `err.response` does NOT exist here, so the server's
      // `error: 'LAST_STRATEGIST'` code does not survive the mapping. The 409
      // status does, and on this endpoint it means exactly one thing.
      if (err?.httpStatus === 409) setPending(role);
      else setError(err?.message ?? 'Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <select
        value={user.collabRole ?? 'STRATEGIST'}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        aria-label={`Workspace role for ${user.email}`}
        className="rounded border border-lumi-border bg-lumi-surface px-2 py-1 font-mono text-xs text-lumi-text disabled:opacity-50"
      >
        {WORKSPACE_ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
      </select>
      {error && <p className="mt-1 text-[10px] text-signal-kill">{error}</p>}

      <ConfirmModal
        open={pending !== null}
        variant="warning"
        title="Last strategist in workspace"
        description={`Downgrading ${user.email} leaves this workspace with no strategist. Nobody in it will be able to manage roles, invite members, or execute decisions — and only an admin can undo it.`}
        confirmLabel="Downgrade anyway"
        cancelLabel="Cancel"
        onConfirm={() => { const role = pending; setPending(null); change(role, true); }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

export function UsersTab() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [offset, setOffset] = useState(0);

  const debouncedQ = useDebounce(q, 300);

  // The role filter runs on the SERVER now. Filtering the loaded page in the
  // browser meant that with more users than the cap, selecting ADMIN could say
  // "No users match this filter" while an admin existed just past the cap.
  const fetcher = useCallback(
    () => fetchUsers({ q: debouncedQ, role, limit: PAGE_SIZE, offset }),
    [debouncedQ, role, offset],
  );
  const { data, loading, error, reload } = useAsync(fetcher);

  const rows = data?.users ?? [];
  const total = data?.total ?? 0;
  const filtered = Boolean(debouncedQ || role);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          placeholder="Search by email…"
          aria-label="Search users by email"
          className="max-w-xs flex-1 rounded-md border border-lumi-border bg-lumi-surface px-2 py-1.5 text-xs text-lumi-text placeholder:text-lumi-subtle focus:border-lumi-accent focus:outline-none"
        />
        <div className="inline-flex flex-shrink-0 gap-1 rounded-lg border border-lumi-border p-0.5">
          {FILTERS.map((f) => (
            <button key={f.label} type="button" onClick={() => { setRole(f.value); setOffset(0); }}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] uppercase transition-colors ${
                role === f.value ? 'bg-lumi-elevated text-lumi-text' : 'text-lumi-muted hover:text-lumi-text'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* The server's count under the active filters, not the page length. */}
      <p className="text-sm text-lumi-muted">
        {data ? `${total} user${total === 1 ? '' : 's'}${filtered ? ' matching filters' : ' total'}` : ''}
      </p>

      <AsyncBlock
        loading={loading}
        error={error}
        empty={rows.length === 0}
        emptyLabel={filtered ? 'No users match these filters.' : 'No users.'}
      >
        <div className="overflow-x-auto rounded-xl border border-lumi-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-lumi-border bg-lumi-surface font-mono text-[11px] uppercase tracking-[0.1em] text-lumi-subtle">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">System role</th>
                <th className="px-3 py-2">Collab role</th>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-lumi-border/50 last:border-0">
                  <td className="px-3 py-2 text-lumi-text">{u.email}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span className={u.role === 'ADMIN' ? 'text-lumi-accent' : 'text-lumi-muted'}>{u.role}</span>
                  </td>
                  <td className="px-3 py-2">
                    <RoleSelect user={u} onChanged={reload} />
                  </td>
                  <td className="px-3 py-2 text-lumi-muted">{u.workspaceName ?? '—'}</td>
                  <td className="px-3 py-2 text-lumi-muted">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBlock>

      <Pagination total={total} limit={PAGE_SIZE} offset={offset} onPageChange={setOffset} />
    </div>
  );
}
