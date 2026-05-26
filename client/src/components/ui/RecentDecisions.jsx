// ============================================================
// MARCOM UI Component — Recent Decisions List with Sparkline
// ============================================================
// Displays recent decision history with a 7-day activity sparkline.
// Used in Sidebar to show decision audit trail.
//
// Props:
//   decisions: Array<{ id, campaign, verdict, timestamp }>
//   onViewAll: () => void
// ============================================================
import { VerdictPill } from './DecisionPill.jsx';

// Simple 7-day sparkline (demo data - replace with real aggregation)
function DecisionSparkline({ data = [3, 5, 2, 8, 4, 6, 5] }) {
  const max = Math.max(...data, 1);
  const barWidth = 100 / data.length;

  return (
    <div className="flex items-end gap-[2px] h-6">
      {data.map((count, i) => {
        const height = (count / max) * 100;
        return (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-lumi-accent/60 transition-all duration-200 hover:bg-lumi-accent"
            style={{
              height: `${height}%`,
              minHeight: count > 0 ? '4px' : '2px',
              opacity: count > 0 ? 1 : 0.3,
            }}
            title={`Day ${i + 1}: ${count} decisions`}
          />
        );
      })}
    </div>
  );
}

export default function RecentDecisions({ decisions = [], onViewAll, totalCount = 47 }) {
  const recentDecisions = decisions.slice(0, 3);

  return (
    <div className="px-3">
      {/* Header with sparkline */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="section-label">Recent</span>
        <div className="w-16">
          <DecisionSparkline />
        </div>
      </div>

      {/* Decision list */}
      {recentDecisions.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-lumi-subtle font-mono">No decisions yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {recentDecisions.map((decision) => (
            <button
              key={decision.id}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-lumi-elevated transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="font-display font-medium text-xs text-dark-base truncate leading-tight">
                  {decision.campaign}
                </div>
                <div className="font-mono text-[10px] text-lumi-subtle mt-0.5">
                  {decision.timestamp || '2h ago'}
                </div>
              </div>
              <VerdictPill verdict={decision.verdict} size="sm" showIcon={false} />
            </button>
          ))}

          {/* View all */}
          {totalCount > recentDecisions.length && (
            <button
              onClick={onViewAll}
              className="w-full mt-2 px-2.5 py-1.5 rounded-lg border border-dashed border-lumi-border
                         text-xs text-lumi-muted hover:text-lumi-accent hover:border-lumi-accent hover:bg-lumi-accent-soft/20
                         transition-all duration-150 font-display font-medium"
            >
              View all {totalCount} decisions
            </button>
          )}
        </div>
      )}
    </div>
  );
}
