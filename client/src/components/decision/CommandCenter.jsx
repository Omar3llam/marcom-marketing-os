// ============================================================
// MARCOM / Lumi — CommandCenter v4.2 (Enterprise Dual-Zone)
// ------------------------------------------------------------
// ZONE A (TOP): 🔴 ACTIVE RADAR — Proactive bleeding campaign alerts
// ZONE B (BOTTOM): MANUAL OS TOOLS — Reactive 3-card grid
//
// This is NOT a chatbot. Every alert ends in a strict Verdict.
// The system is proactive (radar) AND reactive (manual upload).
//
// v4.2 improvements:
// - Added loading/error state handling
// - Enhanced empty state with CTAs
// - Better responsive design
// - Integrated Memory API data
// ============================================================
import { Upload, AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import OutcomeHeader  from '../commandcenter/OutcomeHeader.jsx';
import RadarFeed      from '../commandcenter/RadarFeed.jsx';
import HeroToolCard   from '../commandcenter/HeroToolCard.jsx';
import ActivityTicker from '../commandcenter/ActivityTicker.jsx';
import TrustStrip     from '../commandcenter/TrustStrip.jsx';
import { CardSkeleton } from '../ui/Skeleton.jsx';
import { displaySpend, displayCount } from '@/lib/metricDisplay.js';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';

export default function CommandCenter({
  history,
  radarAlerts = [],
  summary,
  metaStatus = 'unknown',
  onStartFlow,
  onReviewAlert,
  onReplay,
  onClearHistory,
}) {
  const { loading, error, refresh, memory } = useIntelligence();

  // Wire summary metrics into campaign hero card
  const campaignMetrics = {
    total: displayCount(summary?.total, 'active'),
    spend: displaySpend(summary?.spend),
  };

  // True when the authenticated user has 0 campaigns uploaded yet.
  // summary.total = campaigns.length (from IntelligenceContext / summarize()).
  const noCampaigns = (summary?.total ?? 0) === 0;

  // ══════════════════════════════════════════════════════════════
  // LOADING STATE: Show skeleton loaders while fetching data
  // ══════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-light p-6 lg:p-12 max-w-7xl mx-auto">
        <OutcomeHeader />
        <div className="space-y-4 mb-8">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // ERROR STATE: Show error message with retry option
  // ══════════════════════════════════════════════════════════════
  if (error) {
    return (
      <div className="min-h-screen bg-surface-light p-6 lg:p-12 max-w-7xl mx-auto">
        <OutcomeHeader />
        <div className="rounded-2xl border border-signal-kill/20 bg-signal-kill/5 p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-signal-kill/10">
            <AlertCircle className="h-6 w-6 text-signal-kill" strokeWidth={1.5} />
          </div>
          <h2 className="font-display font-bold text-lg text-dark-base mb-2">
            Failed to load intelligence data
          </h2>
          <p className="text-sm text-dark-soft mb-6 max-w-md mx-auto">
            {error}
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-lumi-gold text-dark-base font-display font-semibold text-sm shadow-gold-glow hover:bg-lumi-deep transition-all"
          >
            <RefreshCw className="w-4 h-4" strokeWidth={2} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-light p-4 sm:p-6 lg:p-12 max-w-7xl mx-auto animate-fade-in">
      <OutcomeHeader />
      <ActivityTicker radarAlerts={radarAlerts} history={history} summary={summary} />

      {/* Meta Ads disconnected banner — shown when /api/v1/paid/radar returns 503 */}
      {metaStatus === 'disconnected' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-lumi-gold/30 bg-lumi-gold/5 px-4 py-3">
          <WifiOff className="h-4 w-4 shrink-0 text-lumi-gold" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <span className="font-display text-sm font-semibold text-dark-base">Meta Ads not connected</span>
            <span className="ml-2 font-body text-sm text-dark-soft">
              Radar alerts are unavailable. Connect your account in{' '}
              <a href="/settings/integrations" className="underline underline-offset-2 text-lumi-gold hover:text-lumi-deep transition-colors">
                Settings → Integrations
              </a>
              .
            </span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* EMPTY STATE: Enhanced with clear CTAs and onboarding guidance  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {noCampaigns && (
        <section className="mb-12">
          <div className="rounded-2xl border border-dashed border-lumi-gold/30 bg-lumi-gold/5 p-8 sm:p-12 text-center shadow-card">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-lumi-gold/10 border border-lumi-gold/20">
              <Upload className="h-7 w-7 text-lumi-gold" strokeWidth={1.5} />
            </div>
            <h2 className="decision-title text-dark-base mb-2">
              Welcome to MARCOM Intelligence
            </h2>
            <p className="text-sm text-dark-soft max-w-md mx-auto mb-8">
              Upload a CSV from Meta Ads Manager to get AI-powered campaign intelligence with KILL / SCALE / HOLD verdicts in ~18 seconds.
            </p>
            <button
              type="button"
              onClick={() => onStartFlow('campaign')}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-lumi-gold text-dark-base font-display font-bold text-base shadow-gold-glow hover:bg-lumi-deep hover:scale-105 transition-all"
            >
              <Upload className="w-5 h-5" strokeWidth={2} />
              Upload Your First Campaign
            </button>
            <p className="mt-4 text-xs text-dark-soft/70 font-mono">
              Or connect Meta Ads API for automated monitoring
            </p>
          </div>
        </section>
      )}

      {/* Only show these sections when user has campaigns */}
      {!noCampaigns && (
        <>
          <RadarFeed radarAlerts={radarAlerts} onReviewAlert={onReviewAlert} />
          <HeroToolCard campaignMetrics={campaignMetrics} onStartFlow={onStartFlow} />
        </>
      )}

      {/* Always show TrustStrip (handles its own empty state) */}
      <TrustStrip
        history={history}
        memory={memory}
        onReplay={onReplay}
        onClearHistory={onClearHistory}
        onStartFlow={onStartFlow}
      />
    </div>
  );
}
