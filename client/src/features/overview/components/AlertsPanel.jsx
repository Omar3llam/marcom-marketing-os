// ============================================================
// MARCOM — Alerts Panel (Overview AI Insight layer)
// ============================================================
// Shows HIGH-severity campaigns (KILL or WATCH with high impact score).
// Deep-links to the Campaigns page with ?entity=<id> to scroll to the row.
// Empty state shown honestly when no alerts.
// ============================================================
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';

export default function AlertsPanel({ campaigns = [] }) {
  // HIGH-severity = KILL or WATCH with impact >= 7
  const alerts = campaigns
    .filter((c) => c.verdict === 'KILL' || (c.verdict === 'WATCH' && c.impactScore >= 7))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3);

  return (
    <div className="card-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-lumi-text flex items-center gap-2">
          <AlertTriangle size={14} className="text-signal-kill" />
          Alerts
        </h3>
        {alerts.length > 0 && (
          <span className="text-xs text-lumi-muted">{alerts.length} high priority</span>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="text-xs text-lumi-muted">No critical campaigns right now.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((c) => (
            <Link
              key={c.entityId}
              to={`${appRoutes.campaigns}?entity=${c.entityId}`}
              className="block p-2 rounded-lg bg-lumi-surface hover:bg-lumi-elevated transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-lumi-text truncate max-w-[140px]">
                  {c.name || 'Unnamed campaign'}
                </span>
                <VerdictPill verdict={c.verdict} size="xs" showIcon={false} />
              </div>
              <p className="text-xs text-lumi-muted mt-0.5">
                Impact {c.impactScore}/10
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
