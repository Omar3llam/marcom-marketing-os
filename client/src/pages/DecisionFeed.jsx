// ============================================================
// MARCOM / Lumi — DecisionFeed page (default /app view)
// ------------------------------------------------------------
// The two-pane Decision OS that used to live at /app:
//   - Left: ActionQueue (sorted, scrollable)
//   - Right: DecisionTheater (signal rows, dual-agent action)
// Header is now owned by the page (small section header), the
// global app header lives in the MainLayout shell.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams }                  from 'react-router-dom';
import { CloudUpload, X }                   from 'lucide-react';
import ActionQueue       from '@/components/feed/ActionQueue.jsx';
import DecisionTheater   from '@/components/feed/DecisionTheater.jsx';
import FeedSkeleton      from '@/components/ui/FeedSkeleton.jsx';
import CsvUploader       from '@/components/upload/CsvUploader.jsx';
import { useFeed }       from '@/hooks/useFeed.js';
import { cn }            from '@/lib/utils.js';

export default function DecisionFeed() {
  const { decisions, loading, error, refetch, setDecisions } = useFeed();
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [uploadOpen, setUploadOpen]             = useState(false);
  const [params, setParams]                     = useSearchParams();

  // ?upload=1 in the URL (from the sidebar) → auto-open the modal
  useEffect(() => {
    if (params.get('upload') === '1') {
      setUploadOpen(true);
      params.delete('upload');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (!selectedDecision && decisions.length > 0) {
      setSelectedDecision(decisions[0]);
    }
  }, [decisions, selectedDecision]);

  const handleExecute = (executedIds) => {
    setDecisions((prev) => prev.filter((d) => !executedIds.includes(d.id)));
    setSelectedDecision(null);
  };

  const updateDecision = useCallback((next) => {
    setDecisions((prev) => prev.map((d) => (d.id === next.id ? next : d)));
    setSelectedDecision(next);
  }, [setDecisions]);

  return (
    <div className="flex flex-col h-full">
      {/* ── PAGE HEADER ─────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-lumi-border">
        <div>
          <div className="section-label">Decision Feed</div>
          <h1 className="mt-1 font-display font-bold text-2xl text-lumi-text">
            What needs your attention
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-display font-semibold',
            'border border-lumi-border bg-lumi-elevated text-lumi-text',
            'hover:border-lumi-accent/40 hover:shadow-accent-glow transition-all duration-150',
          )}
        >
          <CloudUpload className="w-3.5 h-3.5" strokeWidth={1.5} /> Upload CSV
        </button>
      </header>

      {/* ── BODY: 360px queue + theater ─────────────────────── */}
      <div className="grid grid-cols-[360px_1fr] flex-1 overflow-hidden">
        <aside className="flex flex-col border-r border-lumi-border overflow-y-auto">
          {loading ? (
            <FeedSkeleton />
          ) : error ? (
            <ErrorCard message={error} onRetry={refetch} />
          ) : decisions.length === 0 ? (
            <EmptyState onUpload={() => setUploadOpen(true)} />
          ) : (
            <ActionQueue
              decisions={decisions}
              selectedDecision={selectedDecision}
              onSelect={setSelectedDecision}
            />
          )}
        </aside>

        <main className="overflow-hidden">
          {!loading && !error && decisions.length > 0 && (
            <DecisionTheater
              selectedDecision={selectedDecision}
              onExecute={handleExecute}
              onUpdateDecision={updateDecision}
            />
          )}
        </main>
      </div>

      {/* ── UPLOAD MODAL ────────────────────────────────────── */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-lumi-border-strong bg-lumi-surface p-6 shadow-modal animate-slide-up">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display font-bold text-lg text-lumi-text">Upload campaign data</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setUploadOpen(false)}
                className="rounded-md p-1 text-lumi-muted hover:bg-lumi-elevated hover:text-lumi-text"
              ><X className="w-4 h-4" strokeWidth={1.5} /></button>
            </div>
            <CsvUploader onSuccess={() => { setUploadOpen(false); refetch(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-signal-kill/30 bg-lumi-surface p-6 text-center">
        <p className="font-display font-semibold text-signal-kill">Failed to load decisions</p>
        {message && <p className="mt-1 text-xs text-lumi-subtle break-all">{message}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal-kill-bg px-3 py-1.5 text-xs font-display font-semibold text-signal-kill hover:bg-signal-kill/20"
        >Retry now</button>
      </div>
    </div>
  );
}

function EmptyState({ onUpload }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        <CloudUpload className="mx-auto w-8 h-8 text-lumi-subtle" strokeWidth={1.5} />
        <p className="mt-3 font-display font-medium text-lumi-text">No campaigns yet</p>
        <p className="mt-1 text-xs text-lumi-muted">
          Upload a Meta or Google Ads CSV to seed your decision queue.
        </p>
        <button
          type="button"
          onClick={onUpload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-display font-semibold text-lumi-bg hover:bg-lumi-accent-hover"
        >
          <CloudUpload className="w-3.5 h-3.5" strokeWidth={1.5} /> Upload CSV
        </button>
      </div>
    </div>
  );
}
