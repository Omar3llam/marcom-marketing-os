import { Activity, Clock } from 'lucide-react';
import { cn } from '../../lib/utils.js';

function MetricCard({ label, value, icon, color }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-light p-4">
      <div className="mb-1 font-body text-xs text-dark-soft">{label}</div>
      <div className={cn('flex items-baseline gap-2', color)}>
        <span className="text-[1.5rem]">{icon}</span>
        <span className="font-display text-[1.875rem] font-bold">{value}</span>
      </div>
    </div>
  );
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MetricsSummary({ liveData }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-5 w-5 text-lumi-gold" />
        <h2 className="font-display text-lg font-semibold text-dark-base">Execution Health</h2>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Active"     value={liveData?.executions?.active || 0}            icon="▶" color="text-signal-scale" />
        <MetricCard label="Paused"     value={liveData?.executions?.paused || 0}            icon="⏸" color="text-lumi-gold" />
        <MetricCard label="Queued"     value={liveData?.executions?.queued || 0}            icon="⏳" color="text-dark-soft" />
        <MetricCard label="Failed (1h)" value={liveData?.executions?.failed_last_hour || 0} icon="✖" color="text-signal-kill" />
      </div>
      <div className="mt-4 border-t border-surface-border pt-4">
        <div className="flex items-center gap-6 font-mono text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-dark-soft" />
            <span className="text-dark-soft">Queue depth:</span>
            <span className="font-semibold text-dark-base">{liveData?.queue?.depth || 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-dark-soft">Avg wait:</span>
            <span className="font-semibold text-dark-base">{formatMs(liveData?.queue?.avg_wait_ms || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
