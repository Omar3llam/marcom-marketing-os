// ============================================================
// MARCOM / Admin — Tab 5 · Audit Log
// ------------------------------------------------------------
// Every mutation the admin panel has performed, newest first. This is the only
// durable record of who changed a role, granted a plan, or destroyed a demo
// workspace — the process log rotates, this does not.
//
// Cursor pagination rather than useAsync: pages accumulate, so the shared hook
// (which replaces `data` on every call) is the wrong shape here.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLog } from './api.js';
import { AsyncBlock } from './parts.jsx';
import { actionLabel, describeChange, shortId, formatWhen } from './auditFormat.js';

export function AuditTab() {
  const [logs, setLogs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (before) => {
    try {
      const data = await fetchAuditLog(before);
      // Append on paging, replace on the first load.
      setLogs((prev) => (before ? [...prev, ...(data.logs ?? [])] : (data.logs ?? [])));
      setCursor(data.nextCursor ?? null);
      setError(null);
    } catch (err) {
      setError(err?.message ?? 'Failed to load the action log');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(null).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    await load(cursor);
    setLoadingMore(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-lumi-muted">
        Admin-panel actions, newest first. Recorded from the day this log shipped — earlier
        actions were never captured.
      </p>

      <AsyncBlock
        loading={loading}
        error={error}
        empty={logs.length === 0}
        emptyLabel="No admin actions recorded yet."
      >
        <div className="overflow-x-auto rounded-xl border border-lumi-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-lumi-border bg-lumi-surface font-mono text-[11px] uppercase tracking-[0.1em] text-lumi-subtle">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Admin</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const change = describeChange(log);
                return (
                  <tr key={log.id} className="border-b border-lumi-border/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-lumi-muted">{formatWhen(log.createdAt)}</td>
                    <td className="px-3 py-2 text-lumi-text">{log.actorEmail}</td>
                    <td className="px-3 py-2 text-lumi-text">{actionLabel(log.type)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-lumi-muted" title={log.targetId ?? ''}>
                      <span className="text-lumi-subtle">{log.targetType}</span> {shortId(log.targetId)}
                    </td>
                    <td className="px-3 py-2 text-lumi-muted">
                      {change.text}
                      {change.forced && (
                        <span className="ml-2 rounded bg-lumi-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-signal-kill">
                          Forced
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AsyncBlock>

      {cursor && !loading && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="text-xs text-lumi-muted underline transition-colors hover:text-lumi-text disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
