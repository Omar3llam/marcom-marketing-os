import { Fragment } from 'react';
import { ArrowRight } from 'lucide-react';
import { useReveal } from './useReveal.js';

// The product in one glance: what Lumi actually does end to end, from a sync to a
// better-performing account. Deliberately slim (chips + arrows) so it reads as a
// 4-second explainer, distinct from the deeper 6-step workflow below.
const FLOW = [
  { label: 'Campaign synced',           tone: 'neutral'  },
  { label: 'Lumi detects weak signals', tone: 'neutral'  },
  { label: 'Verdict',                   tone: 'accent'   },
  { label: 'Recommended action',        tone: 'neutral'  },
  { label: 'Performance improves',      tone: 'positive' },
];

const NODE_TONE = {
  neutral:  'bg-surface-card border-surface-border',
  accent:   'bg-lumi-accent/10 border-lumi-accent/30',
  positive: 'bg-signal-scale/10 border-signal-scale/30',
};

const TEXT_TONE = {
  neutral:  'text-dark-base',
  accent:   'text-lumi-accent',
  positive: 'text-signal-scale',
};

export function SignalToAction() {
  const [ref, shown] = useReveal();

  return (
    <section ref={ref} className="px-4 sm:px-6 py-16 sm:py-20 border-b border-surface-border/60">
      <div className="max-w-5xl mx-auto">
        <header className="text-center mb-10">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3">
            The loop
          </div>
          <h2 className="decision-title sm:text-4xl text-dark-base">
            From signal to action.
          </h2>
        </header>

        <div className={`flex flex-col lg:flex-row lg:items-stretch gap-3 ${shown ? 'animate-slide-up' : 'opacity-0'}`}>
          {FLOW.map((node, i) => (
            <Fragment key={node.label}>
              <div className={`flex-1 flex items-center justify-center text-center rounded-xl border px-4 py-5 ${NODE_TONE[node.tone]}`}>
                <span className={`font-display text-sm font-semibold ${TEXT_TONE[node.tone]}`}>
                  {node.label}
                </span>
              </div>
              {i < FLOW.length - 1 && (
                <div className="flex items-center justify-center shrink-0">
                  <ArrowRight
                    className="w-4 h-4 text-lumi-accent/50 rotate-90 lg:rotate-0"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
