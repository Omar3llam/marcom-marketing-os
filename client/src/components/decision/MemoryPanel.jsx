// client/src/components/decision/MemoryPanel.jsx
// Displays CMO memory patterns + recent decision narratives
// Props: patterns[], narratives[], total (all from GET /api/memory/patterns)
import { Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export default function MemoryPanel({ patterns = [], narratives = [], total = 0 }) {

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-surface-border
                      bg-surface-light/40 py-10 text-center shadow-card">
        <Brain className="w-8 h-8 mx-auto text-dark-soft mb-3" strokeWidth={1.5} />
        <p className="font-display font-semibold text-dark-base text-sm">
          Memory layer is empty
        </p>
        <p className="mt-1 font-body text-xs text-dark-soft">
          Every approved decision is remembered here. MARCOM learns as you act.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
        <Brain className="w-4 h-4 text-lumi-gold" strokeWidth={1.5} />
        <span className="font-mono text-xs uppercase tracking-widest text-dark-soft">
          Decision Memory
        </span>
        <span className="ml-auto font-mono text-xs text-dark-soft/60">
          {total} decisions logged
        </span>
      </div>

      {/* Patterns */}
      {patterns.length > 0 && (
        <div className="px-5 py-4 border-b border-surface-border">
          <p className="font-mono text-[10px] uppercase tracking-widest text-dark-soft/60 mb-3">
            Pattern analysis
          </p>
          <div className="space-y-2">
            {patterns.slice(0, 3).map((p) => (
              <div key={p.action}
                className="flex items-center justify-between gap-4">
                <span className="font-mono text-xs text-dark-soft">{p.action}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-dark-soft/60">
                    {p.count}×
                  </span>
                  {p.avgDeltaRoas !== null && (
                    <div className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                      p.avgDeltaRoas > 0 ? 'text-signal-scale' :
                      p.avgDeltaRoas < 0 ? 'text-signal-kill' : 'text-dark-soft'
                    }`}>
                      {p.avgDeltaRoas > 0 ? <TrendingUp className="w-3 h-3" /> :
                       p.avgDeltaRoas < 0 ? <TrendingDown className="w-3 h-3" /> :
                       <Minus className="w-3 h-3" />}
                      {p.avgDeltaRoas > 0 ? '+' : ''}{p.avgDeltaRoas} ROAS
                    </div>
                  )}
                  <span className={`font-mono text-xs ${
                    p.sustainableRate >= 70 ? 'text-signal-scale' :
                    p.sustainableRate >= 40 ? 'text-signal-hold' : 'text-dark-soft'
                  }`}>
                    {p.sustainableRate}% sustained
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent narratives */}
      <ul className="divide-y divide-surface-border">
        {narratives.map((n) => (
          <li key={n.id} className="px-5 py-3">
            <p className="font-body text-xs text-dark-base leading-relaxed">{n.line}</p>
            <p className="mt-1 font-mono text-[10px] text-dark-soft/50">
              {new Date(n.recorded).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
              {n.roas !== null && (
                <span className={cn('ml-2', n.roas > 0 ? 'text-signal-scale' : 'text-signal-kill')}>
                  ROAS delta: {n.roas > 0 ? '+' : ''}{n.roas}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
