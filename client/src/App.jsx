// ============================================================
// MARCOM / Lumi — Decision OS shell  (V1.3 — live data)
// ------------------------------------------------------------
// Two-pane workspace, now driven by `useFeed()` against the
// Phase-6 backend at GET /api/lumi/feed. mockFeedData has
// been retired from the import graph.
// ============================================================
import { useState, useEffect } from 'react';
import { AlertTriangle }       from 'lucide-react';
import ActionQueue             from './components/feed/ActionQueue.jsx';
import DecisionTheater         from './components/feed/DecisionTheater.jsx';
import FeedSkeleton            from './components/ui/FeedSkeleton.jsx';
import { useFeed }             from './hooks/useFeed.js';

export default function App() {
  const { decisions, loading, error, refetch, setDecisions } = useFeed();
  const [selectedDecision, setSelectedDecision] = useState(null);

  // Auto-select the top item once data arrives (or after refetch)
  useEffect(() => {
    if (!selectedDecision && decisions.length > 0) {
      setSelectedDecision(decisions[0]);
    }
  }, [decisions, selectedDecision]);

  const handleExecute = (executedIds) => {
    setDecisions((prev) => prev.filter((d) => !executedIds.includes(d.id)));
    setSelectedDecision(null);
  };

  return (
    <div className="grid h-screen grid-cols-[360px_1fr] bg-gray-950">
      {/* ── Left: queue ─────────────────────────────────────── */}
      <aside className="flex flex-col border-r border-gray-800 bg-gray-950 overflow-y-auto">
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h1 className="text-sm font-bold tracking-widest text-white uppercase">
            Lumi · Decision OS
          </h1>
          <span className="text-[10px] font-medium text-gray-500">
            {loading ? '…' : `${decisions.length} pending`}
          </span>
        </header>

        {loading ? (
          <FeedSkeleton />
        ) : error ? (
          <ErrorCard message={error} onRetry={refetch} />
        ) : (
          <ActionQueue
            decisions={decisions}
            selectedDecision={selectedDecision}
            onSelect={setSelectedDecision}
          />
        )}
      </aside>

      {/* ── Right: theater ──────────────────────────────────── */}
      <main className="overflow-hidden">
        {!loading && !error && (
          <DecisionTheater
            selectedDecision={selectedDecision}
            onExecute={handleExecute}
          />
        )}
      </main>
    </div>
  );
}

// ── Inline error card (kept here to avoid file sprawl) ──────
function ErrorCard({ message, onRetry }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-red-500/30 bg-gray-900 p-6 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-red-400" />
        <p className="mt-3 text-sm text-gray-200">
          Failed to load decisions. Retrying…
        </p>
        {message && (
          <p className="mt-1 text-xs text-gray-500 break-all">{message}</p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
        >
          Retry now
        </button>
      </div>
    </div>
  );
}
