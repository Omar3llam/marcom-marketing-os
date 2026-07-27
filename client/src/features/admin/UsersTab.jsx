// ============================================================
// MARCOM / Admin — Tab 3 · Users
// All users with system role / collab role / workspace. Filter by system role.
// The collab role is editable here: this is the only cross-workspace surface,
// so it is the only place an admin can repair a workspace that locked itself out.
// ============================================================
import { useState } from 'react';
import { fetchUsers, updateUserRole } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';
import { ConfirmModal } from '@/components/ui/ConfirmModal.jsx';

const FILTERS = ['ALL', 'ADMIN', 'VIEWER'];
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
  const { data, loading, error, reload } = useAsync(fetchUsers);
  const [filter, setFilter] = useState('ALL');

  const all = data?.users ?? [];
  const rows = filter === 'ALL' ? all : all.filter((u) => u.role === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-lumi-muted">{data ? `${data.total} users` : ''}</p>
        <div className="inline-flex gap-1 rounded-lg border border-lumi-border p-0.5">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] uppercase transition-colors ${
                filter === f ? 'bg-lumi-elevated text-lumi-text' : 'text-lumi-muted hover:text-lumi-text'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <AsyncBlock loading={loading} error={error} empty={rows.length === 0} emptyLabel="No users match this filter.">
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
    </div>
  );
}
