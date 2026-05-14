// ============================================================
// MARCOM / Lumi — CommandCenter v4.1 (Enterprise Dual-Zone)
// ------------------------------------------------------------
// ZONE A (TOP): 🔴 ACTIVE RADAR — Proactive bleeding campaign alerts
// ZONE B (BOTTOM): MANUAL OS TOOLS — Reactive 3-card grid
//
// This is NOT a chatbot. Every alert ends in a strict Verdict.
// The system is proactive (radar) AND reactive (manual upload).
// ============================================================
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

  return (
    <div className="min-h-screen bg-surface-light p-6 lg:p-12 max-w-7xl mx-auto animate-fade-in">
      <OutcomeHeader />
      <ActivityTicker radarAlerts={radarAlerts} history={history} summary={summary} />
      <RadarFeed radarAlerts={radarAlerts} onReviewAlert={onReviewAlert} />
      <HeroToolCard campaignMetrics={campaignMetrics} onStartFlow={onStartFlow} />
      <TrustStrip history={history} onReplay={onReplay} onClearHistory={onClearHistory} onStartFlow={onStartFlow} />
    </div>
  );
}
