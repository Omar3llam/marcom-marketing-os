// ============================================================
// MARCOM / Lumi — FeedSkeleton
// ------------------------------------------------------------
// Layout-stable loader for the ActionQueue. Renders 3 cards
// matching the real card's height + gap, so when real data
// arrives the queue does not jump.
//
// Structural mirror of ActionQueue card:
//   header row (name + priority badge) → root cause (2 lines)
//   → stage pill row.
// ============================================================
export default function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse"
        >
          {/* Header row: name placeholder + priority badge placeholder */}
          <div className="flex items-start justify-between gap-3">
            <div className="h-4 w-44 rounded bg-gray-700" />
            <div className="h-4 w-14 rounded-full bg-gray-700" />
          </div>

          {/* Root-cause: two muted lines (matches line-clamp-2) */}
          <div className="mt-3 space-y-2">
            <div className="h-3 w-full rounded bg-gray-800" />
            <div className="h-3 w-4/5 rounded bg-gray-800" />
          </div>

          {/* Stage pill row */}
          <div className="mt-4">
            <div className="h-4 w-20 rounded bg-gray-800" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading decisions…</span>
    </div>
  );
}
