import { Zap, Upload, Play } from 'lucide-react';
import Panel from '@/components/ui/Panel.jsx';

export default function QuickActionsPanel({ onUploadCSV, onStartFlow }) {
  const actions = [
    { key: 'upload', label: 'Upload new data', icon: Upload, variant: 'primary' },
    { key: 'run', label: 'Run intelligence scan', icon: Play, variant: 'secondary' },
  ];

  return (
    <Panel
      title="Quick Actions"
      Icon={Zap}
      iconTone="gold"
      meta="shortcuts"
    >
      <div className="space-y-2">
        {actions.map((action) => (
          <button
            key={action.key}
            onClick={action.key === 'upload' ? onUploadCSV : onStartFlow}
            aria-label={action.label}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-150 font-display font-medium text-sm
              focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark ${
              action.variant === 'primary'
                ? 'bg-lumi-accent hover:bg-lumi-accent/90 text-white shadow-accent-glow'
                : 'bg-surface-elevated hover:bg-surface-card text-dark-base border border-surface-border'
            }`}
          >
            <action.icon className="w-4 h-4" strokeWidth={1.5} />
            {action.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}
