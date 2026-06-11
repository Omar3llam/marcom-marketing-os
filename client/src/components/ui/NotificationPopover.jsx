// ============================================================
// MARCOM UI Primitive — NotificationPopover
// ============================================================
// Dropdown popover for notification bell displaying high-priority alerts.
// Shows the MarcomAI intelligence mark when empty.
//
// Props:
//   alerts: Array<{ id, campaign, signal, verdict }> (alert items)
//   onClose: () => void
//   onSelectAlert: (alert) => void
// ============================================================
import { X } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import MarcomAIMark from '@/components/brand/MarcomAIMark.jsx';

export default function NotificationPopover({ alerts, onClose, onSelectAlert }) {
  const hasAlerts = alerts && alerts.length > 0;

  return (
    <div className="w-60 bg-surface-card border border-surface-border rounded-xl shadow-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-border">
        <span className="font-display font-semibold text-sm text-dark-base">
          Notifications
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-elevated transition-colors"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5 text-dark-muted" strokeWidth={1.5} />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {!hasAlerts ? (
          // Empty state
          <div className="px-4 py-8 text-center">
            <MarcomAIMark size="lg" className="mx-auto mb-3 opacity-70" title="MarcomAI" />
            <p className="text-xs text-dark-subtle leading-relaxed">
              All systems nominal
              <br />
              <span className="text-dark-muted">Lumi will ping you when something starts bleeding.</span>
            </p>
          </div>
        ) : (
          // Alert list
          <div className="p-2">
            {alerts.map((alert) => (
              <button
                key={alert.id}
                onClick={() => {
                  onSelectAlert(alert);
                  onClose();
                }}
                className="w-full p-2.5 mb-1.5 last:mb-0 rounded-lg hover:bg-surface-elevated transition-colors text-left border border-transparent hover:border-surface-border"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="font-display font-semibold text-xs text-dark-base line-clamp-1">
                    {alert.campaign}
                  </span>
                  <VerdictPill verdict={alert.verdict} size="sm" showIcon={false} />
                </div>
                <p className="font-mono text-[10px] text-dark-muted line-clamp-2">
                  {alert.signal}
                </p>
                <span className="font-mono text-[9px] text-dark-subtle mt-1 block">
                  {alert.timestamp || '2m ago'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
