// ============================================================
// MARCOM / Lumi — Onboarding Step 7: Plan Selection
// ============================================================

import { Check } from 'lucide-react';
import { PLANS } from '../constants.js';
import { BigHeader, Lede, chipBtn } from '../shared.jsx';
import { cn } from '@/lib/utils.js';

export function PlanStep({ form, set }) {
  const billingCycle = form.billing || 'monthly';

  return (
    <div>
      <BigHeader className="mb-3">Choose your plan</BigHeader>
      <Lede className="mb-8">
        Free during early access. Prices in {form.currency} apply when paid plans launch.
      </Lede>

      <div className="flex justify-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => set('billing', 'monthly')}
          className={chipBtn(billingCycle === 'monthly')}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => set('billing', 'yearly')}
          className={chipBtn(billingCycle === 'yearly')}
        >
          Yearly
          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-signal-scale/20 text-signal-scale">
            Save 17%
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isSelected = form.plan === plan.id;
          const price = billingCycle === 'yearly' ? plan.yearly[form.currency] : plan.prices[form.currency];
          const priceLabel = billingCycle === 'yearly' ? 'per year' : 'per month';

          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => set('plan', plan.id)}
              className={cn(
                'relative flex flex-col items-start p-5 rounded-xl border-2 transition-all text-left',
                isSelected
                  ? 'border-lumi-gold bg-lumi-gold/10 shadow-gold-glow scale-[1.02]'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              )}
            >
              {plan.badge && (
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-lumi-gold text-dark-base">
                  {plan.badge}
                </div>
              )}

              <div className="text-xs font-semibold uppercase tracking-wider text-dark-tertiary mb-1">
                {plan.tag}
              </div>

              <div className="decision-title text-dark-primary mb-1">
                {plan.name}
              </div>

              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="metric-display text-dark-primary">
                    {price.toLocaleString()}
                  </span>
                  <span className="text-sm text-dark-secondary">
                    {form.currency}
                  </span>
                </div>
                <div className="text-xs text-dark-tertiary">
                  {priceLabel}
                </div>
              </div>

              <ul className="space-y-2 text-xs text-dark-secondary flex-1">
                {plan.bullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-lumi-gold flex-shrink-0 mt-0.5" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="mt-5 p-4 rounded-lg bg-surface-muted border border-surface-border">
        <div className="text-xs font-medium text-dark-secondary mb-1">
          Free during early access —
        </div>
        <div className="text-xs text-dark-secondary leading-relaxed">
          You won&apos;t be charged while Lumi is in early access. We&apos;ll let you know before any paid plan begins.
        </div>
      </div>
    </div>
  );
}
