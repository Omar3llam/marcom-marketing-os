import { Zap, Upload, Send, CalendarDays, Target, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Panel from '@/components/ui/Panel.jsx';
import { appRoutes } from '@/app/routeManifest.js';

export default function QuickActionsPanel({ onUploadCSV, onStartFlow }) {
  const navigate = useNavigate();

  const actions = [
    { key: 'upload', label: 'Upload new CSV', sub: 'Get a fresh verdict', icon: Upload, onClick: onUploadCSV },
    { key: 'content', label: 'Fix bleeding copy', sub: 'Open Content Lab', icon: Send, onClick: () => navigate('/app/content') },
    { key: 'calendar', label: 'Plan next 4 weeks', sub: 'Social Calendar', icon: CalendarDays, onClick: () => navigate('/app/tools/calendar') },
    { key: 'growth', label: 'Find growth signal', sub: 'Open Insights', icon: Target, onClick: () => navigate(appRoutes.insights) },
  ];

  return (
    <Panel
      title="Quick actions"
      Icon={Zap}
      iconTone="gold"
      meta={`${actions.length} ready`}
    >
      <div className="flex flex-col gap-1.5">
        {actions.map((action) => (
          <button
            key={action.key}
            onClick={action.onClick}
            aria-label={action.label}
            className="flex items-center gap-3 px-3 py-2.5 bg-surface-elevated border border-surface-border hover:border-lumi-accent/40 hover:bg-surface-card rounded-lg transition-all duration-150 text-left focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
          >
            <div className="w-7 h-7 rounded-lg bg-lumi-accent/10 text-lumi-accent flex items-center justify-center flex-shrink-0">
              <action.icon className="w-3.5 h-3.5" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-xs text-dark-base">{action.label}</div>
              <div className="font-mono text-[10px] text-dark-muted mt-0.5">{action.sub}</div>
            </div>
            <ArrowRight className="w-3 h-3 text-dark-subtle flex-shrink-0" strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </Panel>
  );
}
