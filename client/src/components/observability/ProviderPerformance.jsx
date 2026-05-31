import { Zap } from 'lucide-react';
import { cn } from '../../lib/utils.js';

function ProviderRow({ provider }) {
  const successPct  = Math.round(provider.success_rate * 100);
  const approvalPct = provider.approval_rate !== null ? Math.round(provider.approval_rate * 100) : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-light p-3">
      <div className="flex items-center gap-4">
        <div className="font-display text-sm font-semibold capitalize text-dark-base">{provider.provider}</div>
        <div className="font-mono text-xs text-dark-soft">{provider.executions} exec</div>
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
          <span className="font-semibold text-dark-base">{(provider.avg_latency_ms / 1000).toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}

export function ProviderPerformance({ providersData }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-5 w-5 text-lumi-gold" />
        <h2 className="font-display text-lg font-semibold text-dark-base">Provider Performance (24h)</h2>
      </div>
      <div className="space-y-3">
        {providersData?.providers?.map((provider) => (
          <ProviderRow key={provider.provider} provider={provider} />
        ))}
        {(!providersData?.providers || providersData.providers.length === 0) && (
          <div className="py-4 text-center font-body text-sm text-dark-soft">No provider data available yet</div>
        )}
      </div>
    </div>
  );
}
