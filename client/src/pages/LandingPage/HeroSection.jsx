import { Zap, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useReveal } from './useReveal.js';

export function Hero({ onPrimary }) {
  return (
    <section className="relative grid-bg min-h-[calc(100vh-3.5rem)] flex flex-col justify-center">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="inline-flex items-center gap-2 bg-lumi-accent-soft border border-lumi-accent/30 text-lumi-accent text-xs font-display font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full">
          <Zap className="w-3 h-3" strokeWidth={1.5} />
          NOW LIVE — LUMI AGENT V2
        </div>

        <h1 className="mt-6 font-display font-bold tracking-tight text-lumi-text text-5xl sm:text-6xl lg:text-7xl leading-[1.05]">
          <span className="block">Meet Lumi.</span>
          <span className="block">Your Agentic Marketing</span>
          <span className="block text-lumi-accent">
            Decision Engine.<span className="inline-block w-[3px] h-[0.85em] bg-lumi-accent ml-2 align-middle animate-pulse-slow" aria-hidden="true" />
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-lumi-muted font-body text-base sm:text-lg leading-relaxed">
          Drop a URL. Lock your context in 30 seconds. Get SCALE / HOLD / KILL verdicts on every campaign.
          No consultants. No dashboards. Just decisions.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPrimary}
            className="bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-5 py-3 rounded-xl text-sm inline-flex items-center gap-2 transition-all"
          >
            Start for free <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </button>
          <a
            href="#how-it-works"
            className="font-display font-medium text-lumi-muted hover:text-lumi-text border border-lumi-border hover:border-lumi-border-strong px-5 py-3 rounded-xl text-sm transition-colors"
          >See how it works ↓</a>
        </div>
      </div>
    </section>
  );
}

export function MockOSWindow() {
  const [ref, shown] = useReveal();
  return (
    <section ref={ref} className="px-4 sm:px-6 py-20">
      <div className={cn('max-w-4xl mx-auto', shown && 'animate-slide-up')}>
        <div className="bg-lumi-surface border border-lumi-border rounded-2xl shadow-modal overflow-hidden">
          <div className="bg-lumi-elevated border-b border-lumi-border px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-signal-kill" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-hold" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-scale" aria-hidden="true" />
            <span className="ml-3 font-display text-sm text-lumi-muted">Lumi OS — Context Lock</span>
          </div>

          <div className="p-6 space-y-3">
            <div className="font-mono text-sm text-lumi-muted">
              <span className="text-lumi-subtle mr-2">›</span>
              marcomaiagency.com
            </div>

            <div className="bg-lumi-bg border-l-2 border-lumi-accent p-4 rounded-r-xl font-mono text-sm text-lumi-text leading-relaxed whitespace-pre">
{`CONTEXT LOCK INITIATED
──────────────────────
Company:     MARCOM AI
Industry:    B2B Marketing Agency
Market:      MENA (EG, SA, UAE)
Target:      CMOs, Marketing Directors
Competitors: Identified (3)
Tone:        Professional-Aggressive`}
              <div className="mt-3 inline-flex items-center gap-1.5 bg-signal-scale-bg text-signal-scale border border-signal-scale/25 px-2.5 py-1 rounded-full text-xs font-display font-semibold uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-signal-scale" /> Locked in 28s
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-lumi-elevated border border-lumi-border rounded-xl px-2 py-3 sm:px-6 grid grid-cols-2 sm:grid-cols-4 divide-x divide-lumi-border">
          {[
            ['5',   'AI Modes'],
            ['18',  'Marketing Tools'],
            ['30s', 'Context Build'],
            ['GCC', 'Calibrated'],
          ].map(([value, label]) => (
            <div key={label} className="flex flex-col items-center justify-center py-2 px-2 sm:px-4">
              <div className="font-mono font-bold text-lg text-lumi-accent">{value}</div>
              <div className="text-xs text-lumi-muted mt-0.5 text-center">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
