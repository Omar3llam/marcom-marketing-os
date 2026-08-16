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

// R7 — the 7-day sparkline that used to sit here rendered a hardcoded array,
// [3, 5, 2, 8, 4, 6, 5], on every account that ever loaded the sidebar. Its own
// comment said "demo data - replace with real aggregation". It was a chart of
// nothing, beside a list of real decisions, which is the most convincing way to
// show a number that does not exist. Removed rather than wired: a per-day
// decision count is a real aggregation nobody has asked for, and inventing the
// query to keep the shape would be the same mistake with more steps.

export default function RecentDecisions({ decisions = [], onViewAll, totalCount = 0 }) {
  const recentDecisions = decisions.slice(0, 3);

  return (
    <div className="px-3">
      {/* Header with sparkline */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="section-label">Recent</span>
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
                  {/* An em dash, not a name we do not have. */}
                  {decision.campaign ?? '—'}
                </div>
                {/* `|| '2h ago'` lived here and asserted a time nobody measured.
                    A row with no timestamp now shows no timestamp. */}
                {decision.timestamp && (
                  <div className="font-mono text-[10px] text-lumi-subtle mt-0.5">
                    {decision.timestamp}
                  </div>
                )}
              </div>
              {decision.verdict && <VerdictPill verdict={decision.verdict} size="sm" showIcon={false} />}
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
