// ============================================================
// MARCOM / Lumi — MainAppPage  (the /app route body)
// ------------------------------------------------------------
// Two-pane Decision OS: ActionQueue (left) + DecisionTheater
// (right). Header carries the CSV upload affordance + a Context
// Locked indicator. Bottom bar shows the user identifier so
// stakeholders see who's logged in.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CloudUpload, Lock, X, UserCircle2 } from 'lucide-react';
import { UserButton, useUser } from '@clerk/clerk-react';
import ActionQueue       from '../components/feed/ActionQueue.jsx';
import DecisionTheater   from '../components/feed/DecisionTheater.jsx';
import FeedSkeleton      from '../components/ui/FeedSkeleton.jsx';
import CsvUploader       from '../components/upload/CsvUploader.jsx';
import { useFeed }       from '../hooks/useFeed.js';
import { cn }            from '../lib/utils.js';

export default function MainAppPage() {
  const { decisions, loading, error, refetch, setDecisions } = useFeed();
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [uploadOpen, setUploadOpen]             = useState(false);
  const { user } = useUser();

  useEffect(() => {
    if (!selectedDecision && decisions.length > 0) {
      setSelectedDecision(decisions[0]);
    }
  }, [decisions, selectedDecision]);

  const handleExecute = (executedIds) => {
    setDecisions((prev) => prev.filter((d) => !executedIds.includes(d.id)));
    setSelectedDecision(null);
  };

  // Update the selected decision in place when orchestration completes.
  const updateDecision = useCallback((next) => {
    setDecisions((prev) => prev.map((d) => (d.id === next.id ? next : d)));
    setSelectedDecision(next);
  }, [setDecisions]);

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] bg-gray-950">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-widest text-white uppercase text-sm">
            Lumi · Decision OS
          </span>
          <span className="ml-2 rounded-full border border-gray-800 bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-gray-400">
            {loading ? '…' : `${decisions.length} pending`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
              'border border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800',
            )}
          >
            <CloudUpload className="h-3.5 w-3.5" /> Upload CSV
          </button>
          <UserButton appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />
        </div>
      </header>

      {/* ── BODY: 360px queue + theatre ────────────────────── */}
      <div className="grid grid-cols-[360px_1fr] overflow-hidden">
        <aside className="flex flex-col border-r border-gray-800 bg-gray-950 overflow-y-auto">
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

      {/* ── BOTTOM BAR ─────────────────────────────────────── */}
      <footer className="flex items-center justify-between border-t border-gray-800 px-4 py-2 text-[11px] text-gray-500">
        <div className="flex items-center gap-1.5">
          <UserCircle2 className="h-3.5 w-3.5" />
          <span>{user?.primaryEmailAddress?.emailAddress || user?.id || 'Anonymous'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 text-green-500" />
          <span>Context · Locked</span>
        </div>
      </footer>

      {/* ── UPLOAD MODAL ───────────────────────────────────── */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Upload campaign data</h3>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
              ><X className="h-5 w-5" /></button>
            </div>
            <CsvUploader
              onSuccess={() => { setUploadOpen(false); refetch(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-red-500/30 bg-gray-900 p-6 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-red-400" />
        <p className="mt-3 text-sm text-gray-200">Failed to load decisions. Retrying…</p>
        {message && <p className="mt-1 text-xs text-gray-500 break-all">{message}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
        >Retry now</button>
      </div>
    </div>
  );
}

function EmptyState({ onUpload }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-xs">
        <CloudUpload className="mx-auto h-8 w-8 text-gray-500" />
        <p className="mt-3 text-sm text-gray-300">No campaigns yet.</p>
        <p className="mt-1 text-xs text-gray-500">
          Upload a Meta or Google Ads CSV to seed your decision queue.
        </p>
        <button
          type="button"
          onClick={onUpload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
        >
          <CloudUpload className="h-3.5 w-3.5" /> Upload CSV
        </button>
      </div>
    </div>
  );
}
