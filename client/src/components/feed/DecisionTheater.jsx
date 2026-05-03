// ============================================================
// MARCOM / Lumi — DecisionTheater
// ------------------------------------------------------------
// Centre pane. Renders the selected decision: structured signal
// rows ("WHY"), the recommended action ("WHAT"), and the
// Execute button that opens the ConfirmationModal.
//
// Preserved exactly per V1.2 spec:
//   - useState for `open` and `loading`
//   - handleExecute → setLoading(true) → 1200ms timeout →
//     toast.success → setOpen(false) → onExecute([id])
//   - Empty state placeholder when !selectedDecision
// ============================================================
import { useState } from 'react';
import { toast } from 'sonner';
import {
  TrendingDown, TrendingUp, Minus,
  Zap, Sparkles, Wand2, Palette, Loader2,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { api } from '../../lib/api.js';
import ConfirmationModal from './ConfirmationModal.jsx';

// ── Status → text-colour map ────────────────────────────────
const statusColor = (status) =>
  ({
    danger:   'text-red-400',
    warning:  'text-yellow-400',
    positive: 'text-green-400',
    neutral:  'text-gray-400',
  }[status] ?? 'text-gray-400');

// ── Trend → Lucide icon component map ───────────────────────
const trendIconFor = (trend) => {
  if (trend === 'up')   return TrendingUp;
  if (trend === 'down') return TrendingDown;
  return Minus;
};

// Flat trends always render in neutral grey regardless of status
const trendIconColor = (trend, status) =>
  trend === 'flat' ? 'text-gray-500' : statusColor(status);

export default function DecisionTheater({ selectedDecision, onExecute, onUpdateDecision }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);

  // ── Trigger dual-agent orchestration ───────────────────────
  // Long-running (5–30s). UI shows a clear loading state so the
  // user knows Lumi is "thinking", not stuck.
  const handleOrchestrate = async () => {
    if (!selectedDecision?.campaignId || orchestrating) return;
    setOrchestrating(true);
    try {
      const res = await api.post(`/api/lumi/orchestrate/${encodeURIComponent(selectedDecision.campaignId)}`);
      const merged = {
        ...selectedDecision,
        creativeAssets: res.data?.creativeAssets ?? selectedDecision.creativeAssets,
        actionPlan: {
          ...selectedDecision.actionPlan,
          action: res.data?.strategicAnalysis?.actionPlan?.action ?? selectedDecision.actionPlan?.action,
        },
        rootCause: res.data?.strategicAnalysis?.rootCause ?? selectedDecision.rootCause,
      };
      onUpdateDecision?.(merged);
      toast.success(
        res.data?.creativeAssets?.variants?.length
          ? `Generated ${res.data.creativeAssets.variants.length} creative variants.`
          : 'Strategic analysis updated.',
      );
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Orchestration failed');
    } finally {
      setOrchestrating(false);
    }
  };

  // ── Empty state ────────────────────────────────────────────
  if (!selectedDecision) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Sparkles className="h-8 w-8 opacity-60" />
          <p className="text-sm">Select a decision from the queue to begin.</p>
        </div>
      </div>
    );
  }

  // ── Execute handler (preserved verbatim from spec) ─────────
  const handleExecute = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success(`Action executed: ${selectedDecision.campaignName}`);
      setOpen(false);
      onExecute?.([selectedDecision.id]);
    }, 1200);
  };

  const signals = Array.isArray(selectedDecision.whyDeepDive)
    ? selectedDecision.whyDeepDive
    : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="mb-6 border-b border-gray-800 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Decision · {selectedDecision.stage}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-white">
          {selectedDecision.campaignName}
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          {selectedDecision.rootCause}
        </p>
      </header>

      {/* ── WHY: structured signal rows ──────────────────────── */}
      <section className="mb-6">
        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Why · structured signals
        </h3>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40">
          {signals.map((sig, i) => {
            const Icon = trendIconFor(sig.trend);
            return (
              <div
                key={`${sig.metric}-${i}`}
                className={cn(
                  'flex items-center justify-between gap-4 px-4 py-3',
                  i < signals.length - 1 && 'border-b border-gray-800/50',
                )}
              >
                {/* Left: icon + metric + context */}
                <div className="flex min-w-0 items-center gap-3">
                  <Icon
                    className={cn(
                      'h-5 w-5 shrink-0',
                      trendIconColor(sig.trend, sig.status),
                    )}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">
                      {sig.metric}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {sig.context}
                    </div>
                  </div>
                </div>

                {/* Right: value + delta + status badge */}
                <div className="flex flex-col items-end shrink-0">
                  <div
                    className={cn(
                      'text-lg font-bold leading-none',
                      statusColor(sig.status),
                    )}
                  >
                    {sig.value}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{sig.delta}</div>
                  <div
                    className={cn(
                      'mt-1 text-[10px] font-bold uppercase tracking-wider',
                      statusColor(sig.status),
                    )}
                  >
                    {sig.status}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CREATIVE ASSETS (Phase-8 dual-agent output) ─────── */}
      {selectedDecision.creativeAssets?.variants?.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Creative Variants · Lumi Creative Director
            </h3>
            <span className="text-[10px] font-medium text-gray-500">
              {selectedDecision.creativeAssets.variants.length} option{selectedDecision.creativeAssets.variants.length === 1 ? '' : 's'}
            </span>
          </div>
          {selectedDecision.creativeAssets.creative_strategy_rationale && (
            <p className="mb-3 text-xs italic text-gray-400">
              {selectedDecision.creativeAssets.creative_strategy_rationale}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3">
            {selectedDecision.creativeAssets.variants.map((v, i) => (
              <article
                key={`${v.angle_name}-${i}`}
                className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
              >
                <header className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-blue-300">{v.angle_name}</h4>
                  {v.platform_notes && (
                    <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                      {v.platform_notes}
                    </span>
                  )}
                </header>
                <div className="text-base font-semibold text-white">{v.headline}</div>
                <p className="mt-1 text-sm text-gray-200">{v.primary_text}</p>
                {v.description && (
                  <p className="mt-1 text-xs text-gray-500">{v.description}</p>
                )}
                {v.visual_direction && (
                  <blockquote className="mt-3 flex gap-2 rounded-lg border-l-2 border-yellow-400/50 bg-gray-900 p-2 text-xs text-gray-300">
                    <Palette className="h-3.5 w-3.5 shrink-0 text-yellow-300" />
                    <span className="italic">{v.visual_direction}</span>
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── WHAT: action plan + Execute / Orchestrate ────────── */}
      <section className="mt-auto rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          AI recommended action
        </p>
        <p className="mt-2 text-sm text-gray-200">
          {selectedDecision.actionPlan?.action}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleOrchestrate}
            disabled={orchestrating}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold',
              'border border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
              'hover:bg-yellow-500/15 disabled:opacity-60 disabled:cursor-not-allowed',
            )}
            title="Run Claude analysis + OpenAI creative variants"
          >
            {orchestrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {orchestrating ? 'AI is analyzing & generating…' : 'Run dual-agent analysis'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2',
              'bg-blue-600 text-white text-sm font-semibold',
              'hover:bg-blue-500 transition-colors',
            )}
          >
            <Zap className="h-4 w-4" />
            Execute
          </button>
        </div>
      </section>

      {/* ── Confirmation modal ───────────────────────────────── */}
      <ConfirmationModal
        open={open}
        onClose={() => (loading ? null : setOpen(false))}
        onConfirm={handleExecute}
        selectedDecision={selectedDecision}
        loading={loading}
      />
    </div>
  );
}
