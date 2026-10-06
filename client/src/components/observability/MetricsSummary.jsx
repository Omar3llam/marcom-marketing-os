import { Activity } from 'lucide-react';
import { ObservabilityLiveSchema } from '@/contracts/schemas/observability.schema';

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MetricsSummary({ liveData }) {
  const parsed = ObservabilityLiveSchema.safeParse(liveData);
  if (!parsed.success) return <p role="alert" className="text-sm text-lumi-text">Execution activity unavailable — invalid live response.</p>;
  const { executions, queue } = parsed.data;
  return (
    <section className="rounded-xl border border-surface-border bg-surface-card p-4 sm:p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-5 w-5 text-lumi-gold" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-dark-base">Execution activity</h2>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          ['Active', executions.active], ['Paused', executions.paused],
          ['Queued', executions.queued], ['Failed (1h)', executions.failed_last_hour],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-surface-border bg-surface-light p-3">
          <dt className="font-body text-sm text-dark-soft">{label}</dt>
          <dd className="font-display text-[1.875rem] font-semibold text-dark-base">{value}</dd>
        </div>)}
      </dl>
      <div className="mt-4 border-t border-surface-border pt-4 flex flex-wrap gap-4 font-mono text-sm text-dark-base">
        <p><span className="text-dark-soft">Queue depth:</span> {queue.depth}</p>
        <p><span className="text-dark-soft">Avg wait:</span> {queue.avg_wait_ms === null ? 'Not applicable' : formatMs(queue.avg_wait_ms)}</p>
      </div>
    </section>
  );
}
