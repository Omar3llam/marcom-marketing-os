import { Globe, Gauge, ScanSearch, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useReveal } from './useReveal.js';

export function CapabilitiesGrid() {
  const [ref, shown] = useReveal();
  const cards = [
    {
      icon: Globe, iconClass: 'text-lumi-accent bg-lumi-accent-soft',
      title: 'Context Intelligence',
      body:  'Drop any URL. Lumi scrapes, synthesizes, and locks your complete marketing context in under 30 seconds.',
      mode:  'MODE 1 — CONTEXT', modeClass: 'text-lumi-accent bg-lumi-accent-soft',
    },
    {
      icon: Gauge, iconClass: 'text-signal-kill bg-signal-kill-bg',
      title: 'Campaign Verdict Engine',
      body:  'Every campaign gets a SCALE, HOLD, or KILL verdict. Backed by KPI breakdown, financial impact, and wasted-spend analysis.',
      mode:  'MODE 3 — ANALYSIS', modeClass: 'text-signal-kill bg-signal-kill-bg',
    },
    {
      icon: ScanSearch, iconClass: 'text-stage-scaling bg-stage-scaling/10',
      title: 'Content Interrogation',
      body:  '10-step MARCOM framework scores every piece of content. Structured JSON output with predictions and rewrites.',
      mode:  'MODE 4 — CONTENT', modeClass: 'text-stage-scaling bg-stage-scaling/10',
    },
  ];

  return (
    <section id="features" ref={ref} className="px-4 sm:px-6 py-20">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-12">
          <h2 className="decision-title sm:text-4xl text-lumi-text">
            One agent. Every marketing decision.
          </h2>
          <p className="mt-3 text-lumi-muted text-base max-w-lg mx-auto">
            Lumi operates across five strict modes.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <article
                key={c.title}
                style={shown ? { animationDelay: `${i * 75}ms` } : undefined}
                className={cn(
                  'flex flex-col bg-lumi-surface border border-lumi-border rounded-2xl p-6',
                  'hover:border-lumi-border-strong hover:shadow-card-hover transition-all duration-200',
                  shown && 'animate-slide-up',
                )}
              >
                <div className={cn('w-12 h-12 rounded-xl p-2 flex items-center justify-center', c.iconClass)}>
                  <Icon className="w-7 h-7" strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 font-display font-semibold text-lg text-lumi-text">{c.title}</h3>
                <p className="mt-2 font-body text-sm text-lumi-muted leading-relaxed">{c.body}</p>
                <span className={cn('mt-6 self-start text-xs font-mono px-2 py-1 rounded-lg', c.modeClass)}>
                  → {c.mode}
                </span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const [ref, shown] = useReveal();
  const steps = [
    { n: '01', title: 'Drop your URL or upload your CSV',
      body: 'Whether it\'s your website or last month\'s Meta export, Lumi pulls it apart.' },
    { n: '02', title: 'Lumi locks your business context',
      body: 'Industry, market, audience, tone — all encoded. Every later answer respects it.' },
    { n: '03', title: 'Get AI verdicts on every campaign',
      body: 'SCALE / HOLD / KILL with financial impact. No dashboards to read — decisions to act on.' },
  ];

  return (
    <section id="how-it-works" ref={ref} className="px-4 sm:px-6 py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="bg-lumi-surface border border-lumi-border rounded-2xl shadow-modal overflow-hidden order-2 lg:order-1">
          <div className="bg-lumi-elevated border-b border-lumi-border px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-signal-kill" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-hold" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-scale" aria-hidden="true" />
            <span className="ml-3 font-display text-sm text-lumi-muted">Lumi OS</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-lumi-elevated border border-lumi-border-strong">
              <span className="w-2 h-2 rounded-full bg-signal-scale" />
              <span className="font-display text-sm text-lumi-text">MARCOM-AI</span>
            </div>
            {[
              { label: 'Command Hub',       active: false },
              { label: 'Campaign Analysis', active: true  },
              { label: 'Growth Strategy',   active: false },
              { label: 'Score Content',     active: false },
            ].map((it, i) => (
              <div
                key={it.label}
                style={shown ? { animationDelay: `${i * 80}ms` } : undefined}
                className={cn(
                  'px-3 py-2.5 rounded-xl text-sm font-display flex items-center gap-2',
                  it.active
                    ? 'bg-lumi-elevated border border-lumi-border text-lumi-text shadow-card'
                    : 'text-lumi-muted',
                  shown && 'animate-fade-in',
                )}
              >{it.label}</div>
            ))}
          </div>
        </div>

        <ol className="relative order-1 lg:order-2 space-y-8">
          <span aria-hidden="true" className="hidden sm:block absolute left-[28px] top-12 bottom-8 w-px border-l-2 border-dashed border-lumi-border" />
          {steps.map((s) => (
            <li key={s.n} className="relative flex gap-5">
              <div className="font-mono text-5xl font-bold text-lumi-accent/20 leading-none w-14 shrink-0">{s.n}</div>
              <div>
                <h3 className="font-display font-semibold text-lumi-text text-lg">{s.title}</h3>
                <p className="mt-1 text-lumi-muted text-sm leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
