// ============================================================
// MARCOM / Lumi — CommandCenter v4.1 (Enterprise Dual-Zone)
// ------------------------------------------------------------
// ZONE A (TOP): 🔴 ACTIVE RADAR — Proactive bleeding campaign alerts
// ZONE B (BOTTOM): MANUAL OS TOOLS — Reactive 3-card grid
//
// This is NOT a chatbot. Every alert ends in a strict Verdict.
// The system is proactive (radar) AND reactive (manual upload).
// ============================================================
import { Upload } from 'lucide-react';
import OutcomeHeader  from '../commandcenter/OutcomeHeader.jsx';
import RadarFeed      from '../commandcenter/RadarFeed.jsx';
import HeroToolCard   from '../commandcenter/HeroToolCard.jsx';
import ActivityTicker from '../commandcenter/ActivityTicker.jsx';
import TrustStrip     from '../commandcenter/TrustStrip.jsx';
import { displaySpend, displayCount } from '@/lib/metricDisplay.js';

export default function CommandCenter({
  history,
  radarAlerts = [],
  summary,
  onStartFlow,
  onReviewAlert,
  onReplay,
  onClearHistory,
}) {
  // Wire summary metrics into campaign hero card
  const campaignMetrics = {
    total: displayCount(summary?.total, 'active'),
    spend: displaySpend(summary?.spend),
  };

  // True when the authenticated user has 0 campaigns uploaded yet.
  // summary.total = campaigns.length (from IntelligenceContext / summarize()).
  const noCampaigns = (summary?.total ?? 0) === 0;

  return (
    <div className="min-h-screen bg-surface-light p-6 lg:p-12 max-w-7xl mx-auto animate-fade-in">
      <OutcomeHeader />
      <ActivityTicker radarAlerts={radarAlerts} history={history} summary={summary} />

      {/* Empty state — new user, no CSV uploaded yet */}
      {noCampaigns && (
        <section className="mb-12">
          <div className="rounded-2xl border border-dashed border-lumi-gold/30 bg-lumi-gold/5 p-8 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-lumi-gold/10">
              <Upload className="h-5 w-5 text-lumi-gold" strokeWidth={1.5} />
            </div>
            <p className="font-display font-semibold text-dark-base">No campaigns yet</p>
            <p className="mt-1 text-sm text-dark-soft">
              Upload a CSV from Meta Ads Manager to see your first intelligence analysis.
            </p>
          </div>
        </section>
      )}

      <RadarFeed radarAlerts={radarAlerts} onReviewAlert={onReviewAlert} />
      <HeroToolCard campaignMetrics={campaignMetrics} onStartFlow={onStartFlow} />
      <TrustStrip history={history} onReplay={onReplay} onClearHistory={onClearHistory} onStartFlow={onStartFlow} />
    </div>
  );
}
