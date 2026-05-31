import { TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils.js';

function getStatusColor(status) {
  switch (status) {
    case 'EXECUTING':
    case 'RESUMING':
      return 'bg-signal-scale/10 text-signal-scale';
    case 'PAUSED_FOR_APPROVAL':
      return 'bg-lumi-gold/10 text-lumi-gold';
    case 'PENDING':
    case 'QUEUED':
      return 'bg-surface-border text-dark-soft';
    default:
      return 'bg-surface-border text-dark-base';
  }
}

function ExecutionRow({ execution }) {
  const elapsedSec = Math.round(execution.elapsed_ms / 1000);
  return (
    <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-light px-3 py-2">
      <div className="flex items-center gap-4">
        <div className="font-mono text-xs text-dark-soft">{execution.execution_id.slice(0, 12)}...</div>
        <div className={cn('rounded px-2 py-0.5 font-mono text-xs font-semibold', getStatusColor(execution.status))}>
          {execution.status}
        </div>
        {execution.active_step && (
          <div className="font-body text-xs text-dark-soft">{execution.active_step}</div>
        )}
      </div>
      <div className="font-mono text-xs text-dark-soft">{elapsedSec}s elapsed</div>
    </div>
  );
}

function FailureRow({ failure }) {
  return (
    <div className="rounded-lg border border-signal-kill/20 bg-signal-kill-bg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs text-signal-kill">{failure.execution_id.slice(0, 12)}...</div>
          <div className="rounded bg-signal-kill/10 px-2 py-0.5 font-mono text-xs font-semibold text-signal-kill">
            {failure.status}
          </div>
          <div className="font-body text-xs text-dark-soft">{failure.active_step}</div>
          <div className="font-mono text-xs text-dark-soft capitalize">{failure.provider}</div>
        </div>
        <div className="font-mono text-xs text-dark-soft">{new Date(failure.failed_at).toLocaleTimeString()}</div>
      </div>
      {failure.error_context && (
        <div className="mt-2 font-mono text-xs text-signal-kill/80">{failure.error_context}</div>
      )}
    </div>
  );
}

export function ExecutionTable({ liveData, failuresData }) {
  return (
    <>
      <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-lumi-gold" />
          <h2 className="font-display text-lg font-semibold text-dark-base">Active Executions</h2>
        </div>
        <div className="space-y-2">
          {liveData?.recent_activity?.slice(0, 10).map((exec) => (
            <ExecutionRow key={exec.execution_id} execution={exec} />
          ))}
          {(!liveData?.recent_activity || liveData.recent_activity.length === 0) && (
            <div className="py-4 text-center font-body text-sm text-dark-soft">No active executions</div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-signal-kill" />
          <h2 className="font-display text-lg font-semibold text-dark-base">Recent Failures (24h)</h2>
        </div>
        <div className="space-y-2">
          {failuresData?.failures?.slice(0, 10).map((failure) => (
            <FailureRow key={failure.execution_id} failure={failure} />
          ))}
          {(!failuresData?.failures || failuresData.failures.length === 0) && (
            <div className="py-4 text-center font-body text-sm text-signal-scale">
              No failures in the last 24 hours ✓
            </div>
          )}
        </div>
      </div>
    </>
  );
}
