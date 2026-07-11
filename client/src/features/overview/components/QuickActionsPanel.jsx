// ============================================================
// MARCOM — Quick Actions Panel (Overview AI Insight layer)
// ============================================================
// 4 contextual shortcuts. "Upload Revenue" only shows when no revenue data.
// "Connect Channel" only shows when no connector. Campaigns + Content Lab always
// shown (core operator actions).
// ============================================================
import { Link } from 'react-router-dom';
import { BarChart2, Sparkles, Upload, Plug, ChevronRight, Zap } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';

const ACTIONS = [
  {
    icon: BarChart2,
    label: 'View Campaigns',
    subtitle: 'Verdicts + diagnosis',
    to: appRoutes.campaigns,
    always: true,
  },
  {
    icon: Sparkles,
    label: 'Generate Content',
    subtitle: 'Copy + visual brief',
    to: appRoutes.contentLab,
    always: true,
  },
  {
    icon: Upload,
    label: 'Upload Revenue',
    subtitle: 'Unlock ROAS',
    to: appRoutes.settingsRevenue,
    showWhen: ({ hasRevenue }) => !hasRevenue,
  },
  {
    icon: Plug,
    label: 'Connect a Channel',
    subtitle: 'Add Meta or Google',
    to: appRoutes.settingsIntegrations,
    showWhen: ({ hasConnector }) => !hasConnector,
  },
];

export default function QuickActionsPanel({ hasRevenue = false, hasConnector = false }) {
  const visibleActions = ACTIONS.filter((a) =>
    a.always || a.showWhen?.({ hasRevenue, hasConnector })
  );

  return (
    <div className="card-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-lumi-text flex items-center gap-2">
          <Zap size={14} className="text-lumi-accent" />
          Quick Actions
        </h3>
        <span className="text-xs text-lumi-muted">{visibleActions.length} ready</span>
      </div>

      <div className="space-y-2">
        {visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.label}
              to={action.to}
              className="flex items-center justify-between p-2 rounded-lg bg-lumi-surface hover:bg-lumi-elevated transition-colors group"
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-lumi-accent" />
                <div>
                  <p className="text-xs font-medium text-lumi-text">{action.label}</p>
                  <p className="text-xs text-lumi-muted">{action.subtitle}</p>
                </div>
              </div>
              <ChevronRight size={12} className="text-lumi-muted group-hover:text-lumi-text" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
