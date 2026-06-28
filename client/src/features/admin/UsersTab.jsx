// ============================================================
// MARCOM / Admin — Tab 3 · Users
// All users with system role / collab role / workspace. Filter by system role.
// ============================================================
import { useState } from 'react';
import { fetchUsers } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';

const FILTERS = ['ALL', 'ADMIN', 'VIEWER'];

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium' }); } catch { return '—'; }
}

export function UsersTab() {
  const { data, loading, error } = useAsync(fetchUsers);
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
                  <td className="px-3 py-2 font-mono text-xs text-lumi-muted">{u.collabRole ?? '—'}</td>
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
