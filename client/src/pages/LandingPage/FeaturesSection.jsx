import { Eye, Zap, MessageSquare, Activity, BarChart2, FileText, Plug, Sparkles, Brain } from 'lucide-react';
import { useReveal } from './useReveal.js';

// The path a campaign travels through Lumi — Connect → Collect Signals → Score →
// Verdict → Recommended Actions → Decision Memory. The last step is the moat:
// every call you confirm is scored later, so the loop gets sharper over time.
// Numbered 01–06 to read as a sequence in the 3×2 grid.
const WORKFLOW = [
  { n: '01', Icon: Plug,      label: 'Connect',             desc: 'OAuth your Meta or Google account in 2 minutes.' },
  { n: '02', Icon: Activity,  label: 'Collect Signals',     desc: 'CTR, frequency, spend, ROAS — captured every sync.' },
  { n: '03', Icon: BarChart2, label: 'Score',               desc: 'Every campaign benchmarked against your portfolio.' },
  { n: '04', Icon: Zap,       label: 'Verdict',             desc: 'KILL · SCALE · HOLD · WATCH — with a reason.' },
  { n: '05', Icon: Sparkles,  label: 'Recommended Actions', desc: 'Pause, reallocate, refresh, or scale. Specific steps.' },
  { n: '06', Icon: Brain,     label: 'Decision Memory',     desc: 'Lumi learns from every verdict. Gets sharper over time.' },
];

function VerdictWorkflow() {
  return (
    <div className="mb-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {WORKFLOW.map((step) => (
        <div
          key={step.label}
          className="relative bg-surface-light border border-surface-border rounded-xl p-6 hover:border-lumi-accent/40 transition-colors"
        >
          <span className="absolute top-4 right-5 font-mono text-xs font-semibold text-lumi-accent/50 tabular-nums">
            {step.n}
          </span>
          <step.Icon className="w-7 h-7 text-lumi-accent mb-3" strokeWidth={1.5} />
          <div className="font-display text-base font-bold text-dark-base mb-1">{step.label}</div>
          <p className="text-sm text-dark-muted leading-relaxed">{step.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function CapabilitiesGrid() {
  const features = [
    {
      Icon: Eye,
      title: 'Always watching',
      body: 'Lumi syncs with your Meta and Google accounts continuously. Every campaign is scored on CTR, frequency, spend efficiency, and audience fatigue — every single sync.',
      wide: true,
    },
    {
      Icon: Zap,
      title: 'Clear verdicts',
      body: 'Kill, Hold, Watch, or Scale — with a reason. Not a dashboard to decode. A decision to act on.',
    },
    {
      Icon: MessageSquare,
      title: 'Ask anything',
      body: "Talk to your campaigns in plain language. 'Which campaign is bleeding budget?' 'What should I pause first?' Real answers from live data — in seconds.",
      badge: 'NEW',
    },
    {
      Icon: Activity,
      title: 'Audience fatigue forecast',
      body: 'See which audiences are close to burning out before they get there. Frequency rising too fast? Lumi flags it before your CTR collapses.',
      badge: 'NEW',
    },
    {
      Icon: BarChart2,
      title: 'Revenue-based scoring',
      body: 'Upload your revenue data once. Lumi calculates real ROAS per campaign — not what Meta claims, what actually happened in your business.',
    },
    {
      Icon: FileText,
      title: 'Weekly narratives',
      body: 'Every Monday, a plain-language summary of what happened, what changed, and what needs attention — ready to send to a client.',
      wide: true,
    },
  ];
  const [ref, shown] = useReveal();

  return (
    <section id="features" ref={ref} className="px-4 sm:px-6 py-24 sm:py-28 bg-surface-card border-t border-b border-surface-border">
      <div className="max-w-7xl mx-auto">
        <header className="mb-16 grid lg:grid-cols-2 gap-16 items-end">
          <div>
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3.5">
              How Lumi works
            </div>
            <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight">
              Every campaign gets a verdict.<br />Not another metric.
            </h2>
          </div>
          <p className="text-base text-dark-soft leading-relaxed">
            Lumi watches your account around the clock. When something needs action, you&apos;ll know — before you waste another day.
          </p>
        </header>

        <VerdictWorkflow />

        <div className="grid lg:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <FeatureCard key={f.title} feat={f} delay={i * 70} wide={!!f.wide} shown={shown} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feat, delay, wide, shown }) {
  const Icon = feat.Icon;
  return (
    <div
      className={`relative ${wide ? 'lg:col-span-2 bg-dark-base text-surface-light border-lumi-accent/35 p-9' : 'bg-surface-light border-surface-border p-8'} border rounded-2xl shadow-card hover:border-lumi-accent/40 hover:shadow-card-hover transition-all duration-200 ${shown ? 'animate-slide-up' : 'opacity-0'}`}
      style={shown ? { animationDelay: `${delay}ms` } : undefined}
    >
      {feat.badge && (
        <span className="absolute top-4 right-4 font-mono text-[9px] tracking-[0.08em] uppercase font-semibold px-2 py-1 rounded bg-lumi-accent/15 text-lumi-accent border border-lumi-accent/30">
          {feat.badge}
        </span>
      )}
      <Icon className={`w-10 h-10 ${wide ? 'text-lumi-accent' : 'text-lumi-accent'} mb-4`} strokeWidth={1.5} />
      <h3 className={`decision-title ${wide ? 'text-surface-light' : 'text-dark-base'} mb-2`}>
        {feat.title}
      </h3>
      <p className={`text-sm leading-relaxed ${wide ? 'text-surface-light/85' : 'text-dark-muted'}`}>
        {feat.body}
      </p>
    </div>
  );
}

export function HowItWorks() {
  const [ref, shown] = useReveal();
  const steps = [
    {
      n: '01',
      title: 'Connect in 2 minutes',
      body: 'OAuth connect your Meta or Google account. Lumi starts watching immediately.',
    },
    {
      n: '02',
      title: 'Get your first verdict',
      body: 'Every campaign is scored. You see exactly what to stop, what to hold, and what to scale — with a reason.',
    },
    {
      n: '03',
      title: 'Act with confidence',
      body: 'Confirm a verdict, act on it. Lumi tracks the outcome and gets sharper over time.',
    },
  ];

  return (
    <section id="how" ref={ref} className="px-4 sm:px-6 py-24 sm:py-28">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-16">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3.5">
            Get started
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight max-w-2xl mx-auto">
            From connect to first verdict — in minutes.
          </h2>
        </header>

        <div className="grid lg:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`bg-surface-card border border-surface-border rounded-2xl p-8 shadow-card hover:border-lumi-accent/40 hover:shadow-card-hover transition-all duration-200 ${shown ? 'animate-slide-up' : 'opacity-0'}`}
              style={shown ? { animationDelay: `${i * 100}ms` } : undefined}
            >
              <div className="font-mono text-6xl font-bold text-lumi-accent/20 leading-none mb-4">
                {s.n}
              </div>
              <h3 className="decision-title text-dark-base mb-2">
                {s.title}
              </h3>
              <p className="text-sm text-dark-muted leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
