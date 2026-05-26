// ============================================================
// MARCOM / Lumi — Onboarding Step 5: Spend Tier
// ============================================================

import { SPEND_TIERS, MARKETS } from '../constants.js';
import { BigHeader, Lede, RadioDot } from '../shared.jsx';
import { cn } from '@/lib/utils.js';

export function SpendStep({ form, set }) {
  const selectedMarket = MARKETS.find((m) => m.id === form.market);
  const currencySymbol = {
    EGP: 'EGP',
    SAR: 'SAR',
    AED: 'AED',
    KWD: 'KWD',
    JOD: 'JOD',
    MAD: 'MAD',
  }[form.currency] || form.currency;

  return (
    <div>
      <BigHeader className="mb-3">What's your monthly ad spend?</BigHeader>
      <Lede className="mb-8">
        This helps Lumi calibrate recommendations. We'll use {selectedMarket?.label || 'your market'} pricing in {currencySymbol}.
      </Lede>

      <div className="space-y-3">
        {SPEND_TIERS.map((tier) => (
          <div key={tier.id} className="relative">
            <RadioDot
              id={`spend-${tier.id}`}
              name="spendTier"
              checked={form.spendTier === tier.id}
              onChange={() => set('spendTier', tier.id)}
              label={tier.label}
            />
            {/* Visual bar indicator */}
            <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-white/5 overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  form.spendTier === tier.id ? 'bg-lumi-gold/60' : 'bg-white/10'
                )}
                style={{ width: `${tier.bar * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 p-4 rounded-lg bg-white/[0.02] border border-white/10">
        <div className="text-xs font-medium text-white/60 mb-1">
          Why we ask —
        </div>
        <div className="text-xs text-white/40 leading-relaxed">
          Higher-spend accounts get tighter guardrails on budget allocation,
          while lower tiers get more aggressive exploration and testing recommendations.
        </div>
      </div>
    </div>
  );
}
