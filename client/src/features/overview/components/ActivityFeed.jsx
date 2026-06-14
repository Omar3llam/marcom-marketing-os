import { Activity, Play, Brain, Upload } from 'lucide-react';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';

export default function ActivityFeed({ activity, loading }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-card">
      <h3 className="font-display font-semibold text-[15px] text-dark-base mb-4">
        Recent Activity
      </h3>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 pb-3 border-b border-surface-border last:border-0 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-surface-elevated flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-4 bg-surface-elevated rounded w-3/4" />
                <div className="h-3 bg-surface-elevated rounded w-1/2" />
              </div>
              <div className="h-4 w-16 bg-surface-elevated rounded" />
            </div>
          ))}
        </div>
      ) : activity.length === 0 ? (
        <EmptyPanel text="No recent activity yet." Icon={Activity} />
      ) : (
        <div className="space-y-3">
          {activity.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 pb-3 border-b border-surface-border last:border-0 last:pb-0"
          >
            <div
              className="w-8 h-8 rounded-lg bg-lumi-accent/10 flex items-center justify-center flex-shrink-0 text-lumi-accent"
            >
              {item.type === 'EXECUTION' ? (
                <Play className="w-4 h-4" strokeWidth={1.5} />
              ) : item.type === 'VERDICT' ? (
                <Brain className="w-4 h-4" strokeWidth={1.5} />
              ) : (
                <Upload className="w-4 h-4" strokeWidth={1.5} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-medium text-sm text-dark-base">
                {item.campaign}
              </div>
              <div className="text-xs text-dark-muted mt-0.5">{item.action}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-dark-subtle">{item.time}</span>
              {item.verdict && <VerdictPill verdict={item.verdict} size="sm" showIcon={false} />}
            </div>
          </div>
        ))}
        </div>
      )}
    </div>
  );
}
