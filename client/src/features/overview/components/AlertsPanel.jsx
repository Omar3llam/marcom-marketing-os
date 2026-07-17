// ============================================================
// MARCOM — Alerts Panel (Overview AI Insight layer)
// ============================================================
// Shows HIGH-severity campaigns (KILL or WATCH with high impact score).
// Deep-links to the Campaigns page with ?entity=<id> to scroll to the row.
// Empty state shown honestly when no alerts.
// ============================================================
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDollarSign, Clock } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';

export default function AlertsPanel({ campaigns = [] }) {
  // HIGH-severity = KILL or WATCH with impact >= 7
  const alerts = campaigns
    .filter((c) => c.verdict === 'KILL' || (c.verdict === 'WATCH' && c.impactScore >= 7))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3);

  // Conversion campaigns whose ROAS can't be scored for want of revenue DATA —
  // a tracking gap the operator can close, NOT a performance problem. Server-
  // computed (needsRevenue) so this never disagrees with the Campaigns table.
  const needsRevenue = campaigns.filter((c) => c.needsRevenue);

  // A DIFFERENT story from needsRevenue: revenue WAS uploaded, but it now lags
  // the spend it would be divided by, so the engine stopped scoring it rather
  // than publish a drifted ROAS. Same server-computed flag the Campaigns table
  // reads, so the two surfaces can't disagree about whose revenue went stale.
  const staleRevenue = campaigns.filter((c) => c.revenueStale);

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

      {needsRevenue.length > 0 && (
        <div className="mt-3 pt-3 border-t border-lumi-border">
          <p className="text-xs font-medium text-lumi-text mb-2 flex items-center gap-1.5">
            <CircleDollarSign size={12} className="text-signal-watch" />
            Revenue data needed
          </p>
          <div className="space-y-1">
            {needsRevenue.slice(0, 3).map((c) => (
              <p key={c.entityId} className="text-xs text-lumi-muted truncate">
                · {c.name || 'Unnamed campaign'}
              </p>
            ))}
          </div>
          {needsRevenue.length > 3 && (
            <p className="text-xs text-lumi-subtle mt-1">
              +{needsRevenue.length - 3} more
            </p>
          )}
          <Link
            to={appRoutes.settingsRevenue}
            className="mt-2 block text-xs text-lumi-accent hover:underline"
          >
            Upload revenue data to unlock ROAS →
          </Link>
        </div>
      )}

      {staleRevenue.length > 0 && (
        <div className="mt-3 pt-3 border-t border-lumi-border">
          <p className="text-xs font-medium text-lumi-text mb-2 flex items-center gap-1.5">
            <Clock size={12} className="text-signal-watch" />
            Revenue data outdated
          </p>
          <div className="space-y-1">
            {staleRevenue.slice(0, 3).map((c) => (
              <p key={c.entityId} className="text-xs text-lumi-muted truncate">
                · {c.name || 'Unnamed campaign'}
              </p>
            ))}
          </div>
          {staleRevenue.length > 3 && (
            <p className="text-xs text-lumi-subtle mt-1">
              +{staleRevenue.length - 3} more
            </p>
          )}
          <Link
            to={appRoutes.settingsRevenue}
            className="mt-2 block text-xs text-lumi-accent hover:underline"
          >
            Re-upload revenue to refresh ROAS →
          </Link>
        </div>
      )}
    </div>
  );
}
