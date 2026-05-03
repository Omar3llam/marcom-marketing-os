// ============================================================
// MARCOM / Lumi — ActionQueue
// ------------------------------------------------------------
// Left-pane list of pending decisions.
// Always sorts HIGH → MEDIUM → LOW. The currently-selected
// card shows a blue border + soft glow.
// ============================================================
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const PRIORITY_BADGE = {
  HIGH:   'bg-red-500/20 text-red-400 border border-red-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  LOW:    'bg-gray-500/20 text-gray-400 border border-gray-500/30',
};

export default function ActionQueue({ decisions, selectedDecision, onSelect }) {
  // ── Empty state ────────────────────────────────────────────
  if (!decisions || decisions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <Inbox className="h-6 w-6" />
          <p className="text-sm">No active decisions</p>
        </div>
      </div>
    );
  }

  // ── Sort: HIGH → MEDIUM → LOW (stable for ties) ────────────
  const sorted = [...decisions].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
  );

  return (
    <div className="flex flex-col gap-2 p-3">
      {sorted.map((item) => {
        const isActive = selectedDecision?.id === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect?.(item)}
            className={cn(
              'group w-full text-left rounded-xl p-4',
              'border border-gray-800 bg-gray-900/40',
              'transition-all duration-150 cursor-pointer',
              'hover:bg-gray-800/50',
              isActive &&
                'border-blue-500/50 bg-gray-800/60 shadow shadow-blue-500/10',
            )}
          >
            {/* Header row: campaign name + priority badge */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-white truncate">
                {item.campaignName}
              </h3>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  PRIORITY_BADGE[item.priority] ?? PRIORITY_BADGE.LOW,
                )}
              >
                {item.priority}
              </span>
            </div>

            {/* Root cause — muted, clamped to 2 lines */}
            <p className="mt-2 text-sm text-gray-400 line-clamp-2">
              {item.rootCause}
            </p>

            {/* Stage pill */}
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-md bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                {item.stage}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
