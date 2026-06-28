// ============================================================
// MARCOM / Admin — Tab 1 · System Status
// DB ping + latency, Redis, per-queue depth, worker crons. Refetch on demand.
// ============================================================
import { RefreshCw } from 'lucide-react';
import { fetchStatus } from './api.js';
import { useAsync, AsyncBlock, Card, Pill } from './parts.jsx';

const QUEUE_ORDER = ['actions', 'observer', 'campaign-sync', 'executions', 'agentic', 'narrative'];

function RefreshButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-lumi-border px-3 py-1.5 text-xs text-lumi-muted transition-colors hover:bg-lumi-elevated hover:text-lumi-text"
    >
      <RefreshCw className="h-3.5 w-3.5" /> Refresh
    </button>
  );
}

export function StatusTab() {
  const { data, loading, error, reload } = useAsync(fetchStatus);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton onClick={reload} /></div>

      <AsyncBlock loading={loading} error={error}>
        {data && (
          <div className="space-y-4">
            <Card title="Database">
              <Pill ok={data.db?.ok}>
                {data.db?.ok ? `Connected · ${data.db.latencyMs}ms` : `Down — ${data.db?.error || 'unreachable'}`}
              </Pill>
            </Card>

            <Card title="Redis">
              <Pill ok={data.redis?.ok} warn={data.redis?.disabled}>
                {data.redis?.disabled ? 'Disabled (no REDIS_URL)' : data.redis?.ok ? 'Connected' : `Down — ${data.redis?.error || 'unreachable'}`}
              </Pill>
            </Card>

            <Card title="Queues">
              <div className="space-y-1.5">
                {QUEUE_ORDER.map((name) => {
                  const q = data.queues?.[name];
                  return (
                    <div key={name} className="flex items-center justify-between font-mono text-xs">
                      <span className="text-lumi-text">{name}</span>
                      {!q || q.disabled ? (
                        <span className="text-trend-warning">disabled</span>
                      ) : q.error ? (
                        <span className="text-trend-danger">error</span>
                      ) : (
                        <span className="text-lumi-muted tabular-nums">
                          waiting {q.waiting ?? 0} · active {q.active ?? 0} · failed{' '}
                          <span className={q.failed > 0 ? 'text-trend-danger' : 'text-lumi-muted'}>{q.failed ?? 0}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Worker schedules">
              <div className="space-y-1.5">
                {Object.entries(data.workers || {}).map(([name, w]) => (
                  <div key={name} className="flex items-center justify-between font-mono text-xs">
                    <span className="text-lumi-text">{name}</span>
                    <span className="text-lumi-muted">{w.cron}</span>
                  </div>
                ))}
              </div>
            </Card>

            <p className="text-right font-mono text-[11px] text-lumi-subtle">
              generated {data.generatedAt}
            </p>
          </div>
        )}
      </AsyncBlock>
    </div>
  );
}
