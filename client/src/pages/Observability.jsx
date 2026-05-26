// ============================================================
// MARCOM / Lumi — Mission Control (Observability Dashboard)
// ============================================================
// Real-time execution monitoring dashboard. Shows live system
// health, queue metrics, provider performance, and recent failures.
// Auto-refreshes every 5 seconds for live monitoring.
// ============================================================
import { useState, useEffect } from 'react';
import { Activity, Zap, AlertTriangle, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { cn } from '../lib/utils.js';

export default function Observability() {
  const [liveData, setLiveData] = useState(null);
  const [providersData, setProvidersData] = useState(null);
  const [failuresData, setFailuresData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch all observability data
  const fetchData = async () => {
    try {
      const [live, providers, failures] = await Promise.all([
        api.get('/api/observability/live'),
        api.get('/api/observability/providers'),
        api.get('/api/observability/failures'),
      ]);

      setLiveData(live.data);
      setProvidersData(providers.data);
      setFailuresData(failures.data);
      setError(null);
    } catch (err) {
      console.error('[Observability] Fetch error:', err);
      setError(err.response?.data?.error || 'Failed to load observability data');
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch + auto-refresh every 5s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark">
        <div className="text-dark-soft">Loading mission control...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark">
        <div className="text-signal-kill">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-dark p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[1.5rem] font-bold text-dark-base">
              🛰️ LUMI Mission Control
            </h1>
            <p className="font-body text-sm text-dark-soft">
              Live execution monitoring · Auto-refreshes every 5s
            </p>
          </div>
          <div className="font-mono text-xs text-dark-soft">
            Last update: {liveData ? new Date(liveData.generated_at).toLocaleTimeString() : '—'}
          </div>
        </div>

        {/* Execution Health */}
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-lumi-gold" />
            <h2 className="font-display text-lg font-semibold text-dark-base">
              Execution Health
            </h2>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <MetricCard
              label="Active"
              value={liveData?.executions?.active || 0}
              icon="▶"
              color="text-signal-scale"
            />
            <MetricCard
              label="Paused"
              value={liveData?.executions?.paused || 0}
              icon="⏸"
              color="text-lumi-gold"
            />
            <MetricCard
              label="Queued"
              value={liveData?.executions?.queued || 0}
              icon="⏳"
              color="text-dark-soft"
            />
            <MetricCard
              label="Failed (1h)"
              value={liveData?.executions?.failed_last_hour || 0}
              icon="✖"
              color="text-signal-kill"
            />
          </div>

          {/* Queue Metrics */}
          <div className="mt-4 border-t border-surface-border pt-4">
            <div className="flex items-center gap-6 font-mono text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-dark-soft" />
                <span className="text-dark-soft">Queue depth:</span>
                <span className="font-semibold text-dark-base">
                  {liveData?.queue?.depth || 0}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-dark-soft">Avg wait:</span>
                <span className="font-semibold text-dark-base">
                  {formatMs(liveData?.queue?.avg_wait_ms || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Provider Performance */}
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-lumi-gold" />
            <h2 className="font-display text-lg font-semibold text-dark-base">
              Provider Performance (24h)
            </h2>
          </div>
          <div className="space-y-3">
            {providersData?.providers?.map((provider) => (
              <ProviderRow key={provider.provider} provider={provider} />
            ))}
            {(!providersData?.providers || providersData.providers.length === 0) && (
              <div className="py-4 text-center font-body text-sm text-dark-soft">
                No provider data available yet
              </div>
            )}
          </div>
        </div>

        {/* Active Executions */}
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-lumi-gold" />
            <h2 className="font-display text-lg font-semibold text-dark-base">
              Active Executions
            </h2>
          </div>
          <div className="space-y-2">
            {liveData?.recent_activity?.slice(0, 10).map((exec) => (
              <ExecutionRow key={exec.execution_id} execution={exec} />
            ))}
            {(!liveData?.recent_activity || liveData.recent_activity.length === 0) && (
              <div className="py-4 text-center font-body text-sm text-dark-soft">
                No active executions
              </div>
            )}
          </div>
        </div>

        {/* Recent Failures */}
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-signal-kill" />
            <h2 className="font-display text-lg font-semibold text-dark-base">
              Recent Failures (24h)
            </h2>
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
      </div>
    </div>
  );
}

// ── Metric Card Component ────────────────────────────────────
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

// ── Provider Row Component ───────────────────────────────────
function ProviderRow({ provider }) {
  const successPct = Math.round(provider.success_rate * 100);
  const approvalPct = provider.approval_rate !== null ? Math.round(provider.approval_rate * 100) : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-light p-3">
      <div className="flex items-center gap-4">
        <div className="font-display text-sm font-semibold capitalize text-dark-base">
          {provider.provider}
        </div>
        <div className="font-mono text-xs text-dark-soft">
          {provider.executions} exec
        </div>
      </div>
      <div className="flex items-center gap-6 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className="text-dark-soft">Success:</span>
          <span className={cn('font-semibold', successPct >= 80 ? 'text-signal-scale' : 'text-lumi-gold')}>
            {successPct}%
          </span>
        </div>
        {approvalPct !== null && (
          <div className="flex items-center gap-2">
            <span className="text-dark-soft">Approval:</span>
            <span className={cn('font-semibold', approvalPct >= 75 ? 'text-signal-scale' : 'text-lumi-gold')}>
              {approvalPct}%
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-dark-soft">Latency:</span>
          <span className="font-semibold text-dark-base">
            {(provider.avg_latency_ms / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Execution Row Component ──────────────────────────────────
function ExecutionRow({ execution }) {
  const elapsedSec = Math.round(execution.elapsed_ms / 1000);

  return (
    <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-light px-3 py-2">
      <div className="flex items-center gap-4">
        <div className="font-mono text-xs text-dark-soft">
          {execution.execution_id.slice(0, 12)}...
        </div>
        <div className={cn('rounded px-2 py-0.5 font-mono text-xs font-semibold', getStatusColor(execution.status))}>
          {execution.status}
        </div>
        {execution.active_step && (
          <div className="font-body text-xs text-dark-soft">
            {execution.active_step}
          </div>
        )}
      </div>
      <div className="font-mono text-xs text-dark-soft">
        {elapsedSec}s elapsed
      </div>
    </div>
  );
}

// ── Failure Row Component ────────────────────────────────────
function FailureRow({ failure }) {
  return (
    <div className="rounded-lg border border-signal-kill/20 bg-signal-kill-bg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs text-signal-kill">
            {failure.execution_id.slice(0, 12)}...
          </div>
          <div className="rounded bg-signal-kill/10 px-2 py-0.5 font-mono text-xs font-semibold text-signal-kill">
            {failure.status}
          </div>
          <div className="font-body text-xs text-dark-soft">
            {failure.active_step}
          </div>
          <div className="font-mono text-xs text-dark-soft capitalize">
            {failure.provider}
          </div>
        </div>
        <div className="font-mono text-xs text-dark-soft">
          {new Date(failure.failed_at).toLocaleTimeString()}
        </div>
      </div>
      {failure.error_context && (
        <div className="mt-2 font-mono text-xs text-signal-kill/80">
          {failure.error_context}
        </div>
      )}
    </div>
  );
}

// ── Utilities ────────────────────────────────────────────────

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

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
