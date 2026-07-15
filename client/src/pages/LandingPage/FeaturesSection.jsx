import { MessageSquare, Zap, Brain, Activity, BarChart2, FlaskConical } from 'lucide-react';
import { useReveal } from './useReveal.js';

export function CapabilitiesGrid() {
  const features = [
    {
      Icon: MessageSquare,
      title: 'Ask Lumi anything',
      body: 'Connected to your live campaign data. Ask why CPA jumped, which campaign to pause, where budget is bleeding — get real answers in seconds, not a dashboard to decode.',
      badge: 'NEW',
      wide: true,
    },
    {
      Icon: Zap,
      title: 'Campaign verdicts',
      body: 'Kill, Hold, Watch, or Scale — decided by real signals, not gut feel. CTR, frequency, ROAS, and audience fatigue, scored every sync.',
    },
    {
      Icon: Brain,
      title: "Lumi's read",
      body: "Open any campaign for Lumi's reasoning in plain language. Why it's on HOLD, what signal triggered the call, and what to do next.",
      badge: 'NEW',
    },
    {
      Icon: Activity,
      title: 'Fatigue forecast',
      body: 'See which audiences are close to saturation before they get there. Frequency velocity projects the days until your ads stop working.',
      badge: 'NEW',
    },
    {
      Icon: BarChart2,
      title: 'Blended truth',
      body: 'Ad platforms over-report by 20–40%. Lumi reconciles their numbers against your actual business outcomes so you allocate against reality, not claims.',
    },
    {
      Icon: FlaskConical,
      title: 'Testing OS',
      body: "Run A/B tests with honest confidence intervals. Lumi tells you when a result is statistically significant — and when it isn't.",
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
              Inside Lumi
            </div>
            <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight">
              Built like a trading desk, not a BI tool.
            </h2>
          </div>
          <p className="text-base text-dark-soft leading-relaxed">
            Marketing is capital allocation. Marcom AI treats it that way — audit trails, idempotent execution, memory, and confidence bands on every call.
          </p>
        </header>

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
      title: 'Connect Meta or Google',
      body: 'Link your Meta or Google Ads account. Lumi pulls it in live — every campaign, every KPI, every line item.',
    },
    {
      n: '02',
      title: 'Ask Lumi anything',
      body: 'Ask about your campaigns and get verdicts, reasoning, and fatigue forecasts — all grounded in your live data, not generic advice.',
    },
    {
      n: '03',
      title: 'Execute verdict',
      body: 'KILL/HOLD/SCALE with financial impact. One-tap execute with 4-layer guards, full audit log, and rollback.',
    },
  ];

  return (
    <section id="how" ref={ref} className="px-4 sm:px-6 py-24 sm:py-28">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-16">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3.5">
            How it works
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight max-w-2xl mx-auto">
            Connect. Ask. Execute in one tap.
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
