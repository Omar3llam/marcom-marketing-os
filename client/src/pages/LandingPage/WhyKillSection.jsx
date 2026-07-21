import { useReveal } from './useReveal.js';

// Transparent reasoning: every verdict ships with a paper trail. The scroll
// target for the hero's "See how Lumi decides" CTA (href="#why"). Rendered as a
// timeline so the decline reads as a narrative, not a static list — a healthy
// start, a first warning, then two days of confirmed decay.
const TIMELINE = [
  { day: '7 days ago', signal: 'CTR at 1.8%',               note: 'Healthy — above portfolio average',       status: 'ok'   },
  { day: '4 days ago', signal: 'CTR dropped to 0.9%',       note: 'Frequency crossed 4.0 — first warning',    status: 'warn' },
  { day: 'Yesterday',  signal: 'CTR fell to 0.48%',         note: 'CPA increased 31%. Audience exhausted.',   status: 'kill' },
  { day: 'Today',      signal: 'Frequency 7.1 · No recovery', note: '12 days of decline. Pattern confirmed.', status: 'kill' },
];

const DOT = {
  ok:   'bg-signal-scale',
  warn: 'bg-lumi-accent',
  kill: 'bg-signal-kill',
};

export function WhyLumiDecides() {
  const [ref, shown] = useReveal();

  return (
    <section id="why" ref={ref} className="px-4 sm:px-6 py-24 sm:py-28">
      <div className="max-w-3xl mx-auto">
        <header className="mb-12">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-lumi-accent mb-3">
            Transparent reasoning
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight">
            Why Lumi said KILL
          </h2>
          <p className="mt-4 text-base text-dark-soft leading-relaxed">
            Every verdict has a paper trail. Not a black box.
          </p>
        </header>

        {/* Timeline */}
        <ol className={`relative ml-2 border-l border-surface-border space-y-8 ${shown ? 'animate-slide-up' : 'opacity-0'}`}>
          {TIMELINE.map(({ day, signal, note, status }) => (
            <li key={day} className="relative pl-6">
              <span
                className={`absolute -left-[6.5px] top-1.5 w-3 h-3 rounded-full ring-4 ring-surface-light ${DOT[status]}`}
                aria-hidden="true"
              />
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted mb-1">
                {day}
              </div>
              <p className="font-display text-sm font-semibold text-dark-base">{signal}</p>
              <p className="text-xs text-dark-muted mt-0.5">{note}</p>
            </li>
          ))}
        </ol>

        {/* Verdict result */}
        <div className="mt-10 p-5 rounded-xl bg-signal-kill/10 border border-signal-kill/20">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted mb-2">
            Lumi&apos;s verdict
          </p>
          <div className="flex items-center gap-3 mb-1">
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-lg bg-signal-kill/15 border border-signal-kill/30 font-mono text-sm font-bold tracking-[0.14em] text-signal-kill">
              KILL
            </span>
            <span className="font-mono text-xs text-dark-muted">Confidence 94%</span>
          </div>
          <p className="text-sm text-dark-soft mt-3">
            Pause immediately. Audience exhausted. Budget better spent on a fresh creative.
          </p>
        </div>
      </div>
    </section>
  );
}
