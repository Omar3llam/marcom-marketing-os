// ============================================================
// MARCOM / Lumi — Operations (Runtime Monitor)
// ============================================================
import { Activity, Zap, Database, Cpu, RefreshCw } from 'lucide-react';

export default function OperationsPage() {
  return (
    <div className="min-h-screen bg-surface-light p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-6 h-6 text-lumi-accent" strokeWidth={1.5} />
            <h1 className="metric-display text-dark-base">Operations</h1>
          </div>
          <p className="text-dark-soft text-base">
            Runtime monitoring, health checks, and system diagnostics.
          </p>
        </div>

        {/* Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatusCard
            icon={Zap}
            label="Dual-Agent"
            status="ONLINE"
            statusColor="text-signal-scale"
            detail="Claude + GPT ready"
          />
          <StatusCard
            icon={Database}
            label="Database"
            status="HEALTHY"
            statusColor="text-signal-scale"
            detail="PostgreSQL + Redis"
          />
          <StatusCard
            icon={Cpu}
            label="Queue"
            status="ACTIVE"
            statusColor="text-signal-scale"
            detail="BullMQ processing"
          />
        </div>

        {/* Coming Soon */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-12 text-center">
          <RefreshCw className="w-12 h-12 text-lumi-muted mx-auto mb-4" strokeWidth={1.5} />
          <h2 className="decision-title text-dark-base mb-2">
            Runtime Dashboard Coming Soon
          </h2>
          <p className="text-dark-soft max-w-md mx-auto">
            Live execution metrics, queue health, API latency graphs, and error tracking will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, status, statusColor, detail }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-lumi-accent/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
        </div>
        <div className="flex-1">
          <div className="font-display text-sm font-semibold text-dark-base mb-0.5">
            {label}
          </div>
          <div className={`font-mono text-xs font-bold tracking-wide uppercase ${statusColor}`}>
            {status}
          </div>
        </div>
      </div>
      <div className="text-xs text-dark-soft">{detail}</div>
    </div>
  );
}
