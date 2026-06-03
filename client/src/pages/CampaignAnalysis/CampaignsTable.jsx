// ============================================================
// MARCOM / Lumi — Campaigns Table
// ============================================================
// Grid table with verdict, campaign, stage, health, bleed, time
// Row click → opens detail panel
// ============================================================
import { ChevronRight } from 'lucide-react';
import { VerdictPill, StagePill } from '@/components/ui/DecisionPill.jsx';
import HealthBar from './HealthBar.jsx';

export default function CampaignsTable({ alerts, selectedId, onSelectAlert, loading }) {
  if (loading) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-xl p-8 shadow-card">
        <div className="text-center text-dark-muted font-mono text-sm">Loading campaigns...</div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-xl p-8 shadow-card">
        <div className="text-center text-dark-muted font-mono text-sm">No campaigns match this filter.</div>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden shadow-card">
      {/* Table header */}
      <div className="grid grid-cols-[90px_1fr_120px_110px_110px_110px_32px] gap-3.5 px-[18px] py-3 bg-surface-elevated border-b border-surface-border">
        {['Verdict', 'Campaign / Ad set', 'Stage', 'Health', 'Bleed', 'Time', ''].map((header) => (
          <span
            key={header}
            className="font-mono text-[10px] tracking-[0.08em] uppercase text-dark-muted"
          >
            {header}
          </span>
        ))}
      </div>

      {/* Table rows */}
      {alerts.map((alert) => {
        const isSelected = alert.id === selectedId;
        const health = alert.verdict === 'KILL' ? 28 : alert.verdict === 'HOLD' ? 56 : 82;

        return (
          <div
            key={alert.id}
            onClick={() => onSelectAlert(alert)}
            className={`
              grid grid-cols-[90px_1fr_120px_110px_110px_110px_32px] gap-3.5 px-[18px] py-3.5
              border-b border-surface-border last:border-b-0 items-center cursor-pointer
              transition-all
              ${isSelected
                ? 'bg-lumi-accent/[0.04] border-l-[3px] border-l-lumi-accent pl-[15px]'
                : 'border-l-[3px] border-l-transparent hover:bg-surface-elevated'
              }
            `}
          >
            {/* Verdict */}
            <VerdictPill verdict={alert.verdict} size="sm" showIcon={false} />

            {/* Campaign / Ad set */}
            <div className="min-w-0">
              <div className="font-display font-medium text-sm text-dark-base truncate">
                {alert.campaign}
              </div>
              <div className="font-mono text-[11px] text-dark-muted mt-0.5 truncate">
                {alert.adset} · {alert.signal}
              </div>
            </div>

            {/* Stage */}
            <StagePill stage={alert.stage} />

            {/* Health */}
            <HealthBar health={health} />

            {/* Bleed */}
            <span
              className={`font-mono tabular-nums text-xs ${
                alert.bleed !== '—' ? 'text-signal-kill' : 'text-dark-muted'
              }`}
            >
              {alert.bleed}
            </span>

            {/* Time */}
            <span className="font-mono text-[11px] text-dark-subtle">{alert.time}</span>

            {/* Arrow */}
            <ChevronRight className="w-3.5 h-3.5 text-dark-subtle" strokeWidth={1.5} />
          </div>
        );
      })}
    </div>
  );
}
