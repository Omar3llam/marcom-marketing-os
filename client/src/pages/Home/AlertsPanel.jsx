import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Panel from '@/components/ui/Panel.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';

export default function AlertsPanel({ alerts, onReviewAlert }) {
  return (
    <Panel
      title="Alerts"
      Icon={AlertTriangle}
      iconTone="kill"
      meta={`${alerts.length} high priority`}
    >
      {alerts.length === 0 ? (
        <EmptyPanel text="Nothing burning right now." Icon={AlertTriangle} />
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 3).map((alert) => (
            <button
              key={alert.id}
              onClick={() => onReviewAlert(alert)}
              aria-label={`Review alert for ${alert.campaign}: ${alert.signal}`}
              className="w-full flex items-center gap-2.5 p-3 bg-surface-elevated border border-surface-border hover:bg-surface-card
                         rounded-lg transition-colors text-left focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
              style={{ borderLeft: `3px solid var(--c-${alert.verdict.toLowerCase()})` }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-xs text-dark-base truncate">
                  {alert.campaign}
                </div>
                <div className="font-mono text-[10px] text-dark-muted mt-1">
                  {alert.signal}
                </div>
              </div>
              <VerdictPill verdict={alert.verdict} size="sm" showIcon={false} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
