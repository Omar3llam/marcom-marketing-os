// ============================================================
// MARCOM / Lumi — Home · Revenue Onboarding Banner (post-first-sync)
// ------------------------------------------------------------
// The highest-leverage revenue-capture moment: a workspace has synced at least
// once (real campaigns, scored on engagement signals) but has NO revenue data
// yet, so ROAS-based verdicts stay locked. Shown once per session on the
// Overview — below the connection-health strip — until revenue lands or the user
// dismisses it. Distinct from FirstRunBanner, which fires PRE-sync when there is
// no data at all.
//
// Pure + prop-driven: OverviewView owns the show / dismiss / gating logic; this
// only renders. Gold accent mirrors the revenue motif used across Campaigns.
// ============================================================
import { Link } from 'react-router-dom';
import { TrendingUp, X, ArrowRight } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';

export default function RevenueOnboardingBanner({ campaignCount = 0, onDismiss }) {
  return (
    <div className="relative mb-6 rounded-xl border border-lumi-gold/30 bg-lumi-gold/5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 flex-shrink-0 rounded-lg bg-lumi-gold/10 text-lumi-gold flex items-center justify-center">
            <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-lumi-text mb-1">
              Lumi scored {campaignCount} campaign{campaignCount === 1 ? '' : 's'} on engagement signals.
            </p>
            <p className="text-xs text-lumi-muted leading-relaxed mb-3 max-w-[560px]">
              Connect sales data to unlock profit-based recommendations — see exactly which campaigns to scale and which are wasting budget.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={appRoutes.settingsRevenue}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-lumi-gold text-dark-base hover:bg-lumi-gold/90 transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-gold focus:ring-offset-2 focus:ring-offset-surface-dark"
              >
                Upload revenue data
                <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
              </Link>
              <span className="text-xs text-lumi-muted">Takes 2 minutes · CSV from any platform</span>
            </div>
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex-shrink-0 p-1 rounded-lg text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-gold"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
