// ============================================================
// MARCOM Landing — Pricing Section
// ============================================================
import { Check, Zap, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export function Pricing() {
  const tiers = [
    {
      name: 'Starter',
      price: '$99',
      period: '/month',
      description: 'For solo operators and small teams testing Lumi.',
      features: [
        'Up to 100 campaigns analyzed',
        'CSV upload + Meta integration',
        'KILL/HOLD/SCALE verdicts',
        'Basic outcome attribution',
        'Email support',
      ],
      cta: 'Start free trial',
      popular: false,
    },
    {
      name: 'Growth',
      price: '$299',
      period: '/month',
      description: 'For growing teams running multi-channel campaigns.',
      features: [
        'Up to 500 campaigns analyzed',
        'Multi-workspace support',
        'Advanced attribution engine',
        'Custom brand voice + dialect',
        'Slack integration',
        'Priority support',
      ],
      cta: 'Start free trial',
      popular: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: '',
      description: 'For agencies and large teams with complex needs.',
      features: [
        'Unlimited campaigns',
        'White-label options',
        'Dedicated success manager',
        'Custom integrations',
        'SLA + uptime guarantee',
        'Advanced security & compliance',
      ],
      cta: 'Contact sales',
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="px-4 sm:px-6 py-20 sm:py-28">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-lumi-accent-soft border border-lumi-accent/30 text-lumi-accent text-xs font-display font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full mb-4">
            <Zap className="w-3 h-3" strokeWidth={1.5} />
            Pricing
          </div>
          <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-lumi-text mb-4">
            Built for every stage.
          </h2>
          <p className="text-lumi-muted font-body text-lg max-w-2xl mx-auto leading-relaxed">
            Start with a free 14-day trial. No credit card required.
            Scale as you grow.
          </p>
        </div>

        {/* Tiers */}
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                'relative bg-lumi-surface border rounded-2xl p-6 sm:p-8 flex flex-col',
                tier.popular
                  ? 'border-lumi-accent shadow-accent-glow scale-105'
                  : 'border-lumi-border hover:border-lumi-border-strong transition-colors'
              )}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-lumi-accent text-lumi-bg px-4 py-1 rounded-full text-xs font-display font-bold uppercase tracking-wide">
                  Most Popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-display font-bold text-[1.5rem] text-lumi-text mb-2">
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="font-display font-bold text-4xl text-lumi-text">
                    {tier.price}
                  </span>
                  <span className="text-lumi-muted font-body text-sm">
                    {tier.period}
                  </span>
                </div>
                <p className="text-lumi-muted font-body text-sm leading-relaxed">
                  {tier.description}
                </p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check
                      className={cn(
                        'w-4 h-4 flex-shrink-0 mt-0.5',
                        tier.popular ? 'text-lumi-accent' : 'text-signal-scale'
                      )}
                      strokeWidth={2}
                    />
                    <span className="text-lumi-text font-body text-sm">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className={cn(
                  'w-full font-display font-semibold px-5 py-3 rounded-xl text-sm inline-flex items-center justify-center gap-2 transition-all',
                  tier.popular
                    ? 'bg-lumi-accent text-lumi-bg hover:bg-lumi-accent-hover shadow-accent-glow'
                    : 'bg-lumi-elevated text-lumi-text hover:bg-lumi-border border border-lumi-border'
                )}
              >
                {tier.cta}
                {tier.cta !== 'Contact sales' && (
                  <ArrowRight className="w-4 h-4" strokeWidth={2} />
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Trust banner */}
        <div className="mt-12 text-center">
          <p className="text-lumi-subtle font-mono text-xs">
            Trusted by 240+ workspaces across MENA · UAE · Egypt · KSA
          </p>
        </div>
      </div>
    </section>
  );
}
