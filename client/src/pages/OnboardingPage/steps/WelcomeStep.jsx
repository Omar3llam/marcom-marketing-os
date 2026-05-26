// ============================================================
// MARCOM / Lumi — Onboarding Step 0: Welcome
// ============================================================

import { Sparkles } from 'lucide-react';
import { Eyebrow, BigHeader, Lede } from '../shared.jsx';

export function WelcomeStep() {
  return (
    <div className="text-center py-8">
      <div className="inline-flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-lumi-gold" />
        <Eyebrow>Lumi · Setup</Eyebrow>
      </div>

      <BigHeader className="mb-4">
        Get Lumi watching your campaigns
      </BigHeader>

      <Lede className="mx-auto mb-8">
        Tell us how to think about your brand, your audience, and your goals.
        This helps Lumi generate market-specific verdicts, campaign analysis,
        and growth decisions tailored to your business.
      </Lede>

      <div className="max-w-md mx-auto space-y-3 text-left">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-lumi-gold/20 flex items-center justify-center text-lumi-gold font-mono text-xs font-bold">
            1
          </div>
          <div>
            <div className="text-sm font-medium text-white/90 mb-0.5">
              9 quick steps
            </div>
            <div className="text-xs text-white/50">
              Takes ~3 minutes to complete
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-lumi-gold/20 flex items-center justify-center text-lumi-gold font-mono text-xs font-bold">
            2
          </div>
          <div>
            <div className="text-sm font-medium text-white/90 mb-0.5">
              MENA-first intelligence
            </div>
            <div className="text-xs text-white/50">
              Arabic dialects, local currencies, and region-specific insights
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/10">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-lumi-gold/20 flex items-center justify-center text-lumi-gold font-mono text-xs font-bold">
            3
          </div>
          <div>
            <div className="text-sm font-medium text-white/90 mb-0.5">
              Start optimizing immediately
            </div>
            <div className="text-xs text-white/50">
              Connect your ad accounts and let Lumi analyze your campaigns
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
