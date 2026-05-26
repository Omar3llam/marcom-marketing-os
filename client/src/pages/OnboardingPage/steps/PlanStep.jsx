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
        Start with a 7-day free trial. Cancel anytime. Prices in {form.currency}.
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

              <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-1">
                {plan.tag}
              </div>

              <div className="text-xl font-display font-bold text-white mb-1">
                {plan.name}
              </div>

              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-display font-bold text-white">
                    {price.toLocaleString()}
                  </span>
                  <span className="text-sm text-white/50">
                    {form.currency}
                  </span>
                </div>
                <div className="text-xs text-white/40">
                  {priceLabel}
                </div>
              </div>

              <ul className="space-y-2 text-xs text-white/70 flex-1">
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

      <div className="mt-5 p-4 rounded-lg bg-white/[0.02] border border-white/10">
        <div className="text-xs font-medium text-white/60 mb-1">
          7-day free trial —
        </div>
        <div className="text-xs text-white/40 leading-relaxed">
          You won't be charged until the trial ends. You can cancel anytime from your workspace settings.
        </div>
      </div>
    </div>
  );
}
