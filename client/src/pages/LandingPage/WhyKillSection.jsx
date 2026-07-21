import { useReveal } from './useReveal.js';

// Transparent reasoning: every verdict ships with the evidence behind it. The
// scroll target for the hero's "See how Lumi decides" CTA (href="#why").
const EVIDENCE = [
  { signal: 'CTR fell 42%',           detail: 'Below portfolio average for 8 days' },
  { signal: 'Frequency reached 6.8',  detail: 'Audience has seen this ad too many times' },
  { signal: 'CPA increased 31%',      detail: 'Cost per lead rising with no improvement' },
  { signal: 'No recovery in 12 days', detail: 'Pattern confirmed — not a temporary dip' },
];

export function WhyLumiDecides() {
  const [ref, shown] = useReveal();

  return (
    <section id="why" ref={ref} className="px-4 sm:px-6 py-24 sm:py-28">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-lumi-accent mb-3">
            Transparent reasoning
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight">
            Why Lumi said KILL
          </h2>
          <p className="mt-4 text-base text-dark-soft leading-relaxed">
            Every verdict comes with evidence. Not a black box.
          </p>
        </header>

        <div className={`space-y-3 ${shown ? 'animate-slide-up' : 'opacity-0'}`}>
          {EVIDENCE.map(({ signal, detail }) => (
            <div
              key={signal}
              className="flex gap-3 items-start bg-surface-card border border-surface-border rounded-xl p-4"
            >
              <span className="text-signal-kill text-lg leading-none mt-0.5" aria-hidden="true">•</span>
              <div>
                <p className="font-display text-sm font-semibold text-dark-base">{signal}</p>
                <p className="text-xs text-dark-muted mt-0.5">{detail}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Verdict result */}
        <div className="mt-8 p-5 rounded-xl bg-signal-kill/10 border border-signal-kill/20">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted mb-2">
            Lumi&apos;s verdict
          </p>
          <span className="inline-flex items-center px-3.5 py-1.5 rounded-lg bg-signal-kill/15 border border-signal-kill/30 font-mono text-sm font-bold tracking-[0.14em] text-signal-kill">
            KILL
          </span>
          <p className="text-sm text-dark-soft mt-3">
            Pause immediately. Reallocate budget to your top performer.
          </p>
        </div>
      </div>
    </section>
  );
}
