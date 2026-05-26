import { useState } from 'react';
import { Brain, Trash2, ArrowRight, TrendingUp, Lightbulb } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';
import GuidedPath from './GuidedPath.jsx';

export default function TrustStrip({ history, memory, onReplay, onClearHistory, onStartFlow }) {
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Extract memory insights
  const memoryInsights = memory?.patterns || [];
  const totalDecisions = memory?.total || history.length;

  return (
    <section aria-labelledby="memory-heading" className="space-y-4">
      <div className="flex items-center justify-between mb-3">
        <h2 id="memory-heading" className="section-label inline-flex items-center gap-1.5 text-dark-base">
          <Brain className="w-3 h-3" strokeWidth={1.5} /> Decision Memory
        </h2>
        <div className="flex items-center gap-3">
          {totalDecisions > 0 && (
            <span className="font-mono text-xs text-dark-soft tabular-nums">
              {totalDecisions} decision{totalDecisions !== 1 ? 's' : ''} tracked
            </span>
          )}
          {history.length > 0 && (
            confirmingClear ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-dark-soft">Clear all?</span>
                <button
                  onClick={() => { onClearHistory(); setConfirmingClear(false); }}
                  className="text-signal-kill font-display font-semibold hover:underline"
                  aria-label="Confirm clear history"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setConfirmingClear(false)}
                  className="text-dark-soft hover:text-dark-base"
                  aria-label="Cancel clear history"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="inline-flex items-center gap-1 text-xs text-dark-soft hover:text-signal-kill transition-colors"
                aria-label="Clear decision history"
              >
                <Trash2 className="w-3 h-3" strokeWidth={1.5} /> Clear history
              </button>
            )
          )}
        </div>
      </div>

      {/* Memory patterns — show AI-learned insights */}
      {memoryInsights.length > 0 && (
        <div className="rounded-xl border border-lumi-gold/20 bg-lumi-gold/5 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-lumi-gold" strokeWidth={1.5} />
            <h3 className="font-display font-semibold text-sm text-dark-base">
              AI-Learned Patterns
            </h3>
          </div>
          <ul className="space-y-2">
            {memoryInsights.slice(0, 3).map((pattern, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-lumi-gold shrink-0 mt-0.5" strokeWidth={1.5} />
                <span className="text-dark-soft leading-relaxed">
                  {pattern.pattern || pattern.narrative || pattern.insight}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Decision history */}
      {history.length === 0 ? (
        <GuidedPath onStartFlow={onStartFlow} />
      ) : (
        <ul className="space-y-2">
          {history.slice(0, 5).map((d) => (
            <HistoryRow key={d.id} d={d} onReplay={() => onReplay(d)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({ d, onReplay }) {
  const borderCls =
      d.verdict === 'KILL'     ? 'border-l-2 border-l-signal-kill'
    : d.verdict === 'SCALE'    ? 'border-l-2 border-l-signal-scale'
    : d.verdict === 'HOLD'     ? 'border-l-2 border-l-signal-hold'
    : d.verdict === 'OPTIMIZE' ? 'border-l-2 border-l-stage-testing'
    : 'border-l-2 border-l-surface-border';

  return (
    <li>
      <button
        type="button"
        onClick={onReplay}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onReplay();
          }
        }}
        className={cn(
          'w-full flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 rounded-xl text-left',
          'bg-surface-card border border-surface-border shadow-card',
          borderCls,
          'hover:border-lumi-gold/30 hover:shadow-card-hover focus-visible:border-lumi-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lumi-gold/20 transition-all',
        )}
        aria-label={`Replay ${d.verdict} decision for ${d.title}`}
      >
        <VerdictPill verdict={d.verdict} />
        <div className="flex-1 min-w-0">
          <div className="font-display font-medium text-sm text-dark-base truncate">{d.title}</div>
          <div className="font-mono text-xs text-dark-soft">
            {d.mode.toUpperCase()} · {fmtRelative(d.timestamp)}
          </div>
        </div>
        <span className="text-lumi-gold text-xs font-mono inline-flex items-center gap-1 group-hover:underline shrink-0">
          <span className="hidden sm:inline">Replay</span>
          <ArrowRight className="w-3 h-3" strokeWidth={2} />
        </span>
      </button>
    </li>
  );
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
